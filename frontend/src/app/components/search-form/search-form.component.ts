import { NgbDropdown } from '@ng-bootstrap/ng-bootstrap';
import { Component, OnInit, ChangeDetectionStrategy, EventEmitter, Output, ViewChild, HostListener, ElementRef, Input } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { EventType, NavigationStart, Router } from '@angular/router';
import { AssetsService } from '@app/services/assets.service';
import { Env, StateService } from '@app/services/state.service';
import { TxTaxiExplorer, TxTaxiExplorerRegistryService, TxTaxiSearchCandidate, TxTaxiSearchOptions } from '@app/services/tx-taxi-explorer-registry.service';
import { Observable, defer, of, Subject, zip, BehaviorSubject, combineLatest } from 'rxjs';
import { debounceTime, finalize, distinctUntilChanged, switchMap, catchError, map, shareReplay, startWith, tap } from 'rxjs/operators';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { ApiService } from '@app/services/api.service';
import { SearchResultsComponent } from '@components/search-form/search-results/search-results.component';
import { Network, findOtherNetworks, getRegex, getTargetUrl, needBaseModuleChange } from '@app/shared/regex.utils';

interface SearchTarget {
  kind: 'explorer' | 'candidate' | 'router';
  chainId?: string;
  destinationId?: string;
  destinationDefault?: boolean;
  origin?: string;
  candidate?: TxTaxiSearchCandidate;
  name: string;
  accentColor: string;
  iconUrl: string;
  iconAlt: string;
  searchPlaceholder: string;
  confirmed?: boolean;
  directUrl?: string;
}

@Component({
  selector: 'app-search-form',
  templateUrl: './search-form.component.html',
  styleUrls: ['./search-form.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchFormComponent implements OnInit {
  @Input() hamburgerOpen = false;
  readonly sourceChainId = 'litecoin';
  readonly defaultChainIconUrl = '/resources/chains/litecoin.png';
  readonly defaultChainIconAlt = 'Litecoin explorer';
  readonly defaultChainAccent = '#345d9d';
  readonly defaultSearchPlaceholder = 'Wave a taxi, paste anything here.';
  env: Env;
  network = '';
  assets: object = {};
  pools: object[] = [];
  @ViewChild('chainMenu') chainMenu: NgbDropdown;
  pendingSearchRequests = 0;
  isSearching = false;
  isTypeaheading$ = new BehaviorSubject<boolean>(false);
  typeAhead$: Observable<any>;
  explorers$: Observable<TxTaxiExplorer[]>;
  thirdPartyExplorers$: typeof this.explorerRegistry.thirdPartyExplorers$;
  selectedChainId$ = new BehaviorSubject<string | undefined>(this.sourceChainId);
  activeTarget$ = new BehaviorSubject<SearchTarget>({
    kind: 'explorer',
    chainId: this.sourceChainId,
    name: 'Litecoin',
    accentColor: this.defaultChainAccent,
    iconUrl: this.defaultChainIconUrl,
    iconAlt: this.defaultChainIconAlt,
    searchPlaceholder: this.defaultSearchPlaceholder,
  });
  searchOptions$ = new BehaviorSubject<TxTaxiSearchOptions | undefined>(undefined);
  searchForm: UntypedFormGroup;
  dropdownHidden = false;
  explorerRegistryLoaded = false;
  private manualDestinationId: string | undefined;
  private hasManualSelection = false;
  private readonly selectionChanges$ = new BehaviorSubject(0);
  private readonly additionalExplorerIds = new Set<string>();
  readonly routerHubUrl = this.explorerRegistry.hubUrl;
  private explorers: TxTaxiExplorer[] = [];
  private manualChainId: string | undefined = this.sourceChainId;
  private manualOverrideSearchText: string | undefined;
  private manualOverrideTarget: SearchTarget | undefined;
  private searchOptions: TxTaxiSearchOptions | undefined;
  private suppressMenuOnFocus = false;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event) {
    if (!this.elementRef.nativeElement.contains(event.target)
      && !this.isSearching && !this.pendingSearchRequests && !this.isTypeaheading$.value) {
      this.chainMenu?.close();
    }
    if (this.elementRef.nativeElement.contains(event.target) && this.isSourceChainSelected()) {
      this.dropdownHidden = false;
    } else {
      this.dropdownHidden = true;
    }
  }

  @HostListener('document:keydown.escape')
  closeChainMenu(): void {
    this.chainMenu?.close();
  }

  private querySearchOptions(searchText: string, probe = false): Observable<TxTaxiSearchOptions | undefined> {
    return defer(() => {
      this.pendingSearchRequests++;
      return this.explorerRegistry.searchOptions$(searchText, probe, this.sourceChainId, this.hasManualSelection ? this.manualChainId : undefined, this.hasManualSelection ? this.manualDestinationId : undefined).pipe(
        finalize(() => this.pendingSearchRequests--),
      );
    });
  }

  regexAddress = getRegex('address', 'mainnet'); // Default to mainnet
  regexBlockhash = getRegex('blockhash', 'mainnet');
  regexTransaction = getRegex('transaction');
  regexBlockheight = getRegex('blockheight');
  regexDate = getRegex('date');
  regexUnixTimestamp = getRegex('timestamp');

  focus$ = new Subject<string>();
  click$ = new Subject<string>();

  @Output() searchTriggered = new EventEmitter();
  @ViewChild('searchResults') searchResults: SearchResultsComponent;
  @HostListener('keydown', ['$event']) keydown($event): void {
    this.handleKeyDown($event);
  }

  @ViewChild('searchInput') searchInput: ElementRef;

  constructor(
    private formBuilder: UntypedFormBuilder,
    private router: Router,
    private assetsService: AssetsService,
    private stateService: StateService,
    private electrsApiService: ElectrsApiService,
    private apiService: ApiService,
    private relativeUrlPipe: RelativeUrlPipe,
    private elementRef: ElementRef,
    private explorerRegistry: TxTaxiExplorerRegistryService,
  ) {
    this.explorers$ = this.explorerRegistry.explorers$;
  }

  ngOnInit(): void {
    this.env = this.stateService.env;
    this.thirdPartyExplorers$ = this.explorerRegistry.thirdPartyExplorers$;
    this.stateService.networkChanged$.subscribe((network) => {
      this.network = network;
      // TODO: Eventually change network type here from string to enum of consts
      this.regexAddress = getRegex('address', network as any || 'mainnet');
      this.regexBlockhash = getRegex('blockhash', network as any || 'mainnet');
    });

    this.router.events.subscribe((e: NavigationStart) => { // Reset search focus when changing page
      if (this.searchInput && e.type === EventType.NavigationStart) {
        this.chainMenu?.close();
        this.searchInput.nativeElement.blur();
      }
    });

    this.stateService.searchFocus$.subscribe(() => {
      if (!this.searchInput) { // Try again a bit later once the view is properly initialized
        setTimeout(() => this.focusSearchInputWithoutMenu(), 100);
      } else if (this.searchInput) {
        this.focusSearchInputWithoutMenu();
      }
    });

    this.searchForm = this.formBuilder.group({
      searchText: ['', Validators.required],
    });

    this.explorers$.subscribe((explorers) => {
      this.explorerRegistryLoaded = true;
      this.explorers = explorers;
      this.updateActiveTarget();
    });

    if (this.network === 'liquid' || this.network === 'liquidtestnet') {
      this.assetsService.getAssetsMinimalJson$
        .subscribe((assets) => {
          this.assets = assets;
        });
    }

    const searchText$ = this.searchForm.get('searchText').valueChanges
    .pipe(
      map((text) => {
        return text.trim();
      }),
      tap((text) => {
        this.stateService.searchText$.next(text);
      }),
      distinctUntilChanged(),
      tap((text) => this.clearManualOverrideOnInputChange(text)),
      shareReplay(1),
    );

    const searchContext$ = combineLatest([searchText$.pipe(startWith('')), this.selectionChanges$]);
    searchContext$.pipe(
      debounceTime(120),
      switchMap(([searchText, revision]) => this.querySearchOptions(searchText).pipe(
        map((options) => ({ searchText, revision, options })),
      )),
    ).subscribe(({ searchText, revision, options }) => {
      if (options && this.currentSearchText() === searchText && revision === this.selectionChanges$.value) {
        this.setSearchOptions(options);
      }
    });

    searchContext$.pipe(
      debounceTime(420),
      switchMap(([searchText, revision]) => this.querySearchOptions(searchText, true).pipe(
        map((options) => ({ searchText, revision, options })),
      )),
    ).subscribe(({ searchText, revision, options }) => {
      if (options && this.currentSearchText() === searchText && revision === this.selectionChanges$.value) {
        this.setSearchOptions(options);
      }
    });


    const sourceSearchText$ = combineLatest([searchText$, this.selectedChainId$]).pipe(
      map(([searchText, chainId]) => this.isSourceChainSelected() ? searchText : ''),
      distinctUntilChanged(),
    );

    const searchResults$ = sourceSearchText$.pipe(
      debounceTime(200),
      switchMap((text) => {
        if (!text.length) {
          return of([
            [],
            { nodes: [], channels: [] },
            this.pools
          ]);
        }
        this.isTypeaheading$.next(true);
        if (!this.stateService.networkSupportsLightning()) {
          return zip(
            this.electrsApiService.getAddressesByPrefix$(text).pipe(catchError(() => of([]))),
            [{ nodes: [], channels: [] }],
            this.getMiningPools()
          );
        }
        return zip(
          this.electrsApiService.getAddressesByPrefix$(text).pipe(catchError(() => of([]))),
          this.apiService.lightningSearch$(text).pipe(catchError(() => of({
            nodes: [],
            channels: [],
          }))),
          this.getMiningPools()
        );
      }),
      map((result: any[]) => {
        return result;
      }),
      tap(() => {
        this.isTypeaheading$.next(false);
      })
    );

    this.typeAhead$ = combineLatest(
      [
        sourceSearchText$,
        searchResults$.pipe(
        startWith([
          [],
          {
            nodes: [],
            channels: [],
          },
          this.pools
        ]))
      ]
      ).pipe(
        map((latestData) => {
          this.pools = latestData[1][2] || [];

          let searchText = latestData[0];
          if (!searchText.length) {
            return {
              searchText: '',
              hashQuickMatch: false,
              blockHeight: false,
              txId: false,
              address: false,
              otherNetworks: [],
              addresses: [],
              nodes: [],
              channels: [],
              liquidAsset: [],
              pools: []
            };
          }

          const result = latestData[1];
          const addressPrefixSearchResults = result[0];
          const lightningResults = result[1];

          // Do not show date and timestamp results for liquid
          const isNetworkBitcoin = this.network === '' || this.network === 'testnet' || this.network === 'testnet4' || this.network === 'signet';

          const matchesBlockHeight = this.regexBlockheight.test(searchText);
          const matchesDateTime = this.regexDate.test(searchText) && new Date(searchText).toString() !== 'Invalid Date' && new Date(searchText).getTime() <= Date.now() && isNetworkBitcoin;
          const matchesUnixTimestamp = this.regexUnixTimestamp.test(searchText) && parseInt(searchText) <= Math.floor(Date.now() / 1000) && isNetworkBitcoin;
          const matchesTxId = this.regexTransaction.test(searchText) && !this.regexBlockhash.test(searchText);
          const matchesBlockHash = this.regexBlockhash.test(searchText);
          const matchesAddress = !matchesTxId && this.regexAddress.test(searchText);
          const publicKey = matchesAddress && searchText.startsWith('0');
          const otherNetworks = findOtherNetworks(searchText, this.network as any || 'mainnet', this.env);
          const liquidAsset = this.assets ? (this.assets[searchText] || []) : [];
          const pools = this.pools.filter(pool => pool['name'].toLowerCase().includes(searchText.toLowerCase())).slice(0, 10);

          if (matchesDateTime && searchText.indexOf('/') !== -1) {
            searchText = searchText.replace(/\//g, '-');
          }

          if (publicKey) {
            otherNetworks.length = 0;
          }

          return {
            searchText: searchText,
            hashQuickMatch: +(matchesBlockHeight || matchesBlockHash || matchesTxId || matchesAddress || matchesUnixTimestamp || matchesDateTime),
            blockHeight: matchesBlockHeight,
            dateTime: matchesDateTime,
            unixTimestamp: matchesUnixTimestamp,
            txId: matchesTxId,
            blockHash: matchesBlockHash,
            address: matchesAddress,
            publicKey: publicKey,
            addresses: matchesAddress && addressPrefixSearchResults.length === 1 && searchText === addressPrefixSearchResults[0] ? [] : addressPrefixSearchResults, // If there is only one address and it matches the search text, don't show it in the dropdown
            otherNetworks: otherNetworks,
            nodes: lightningResults.nodes,
            channels: lightningResults.channels,
            liquidAsset: liquidAsset,
            pools: pools
          };
        })
      );
  }

  handleKeyDown($event): void {
    if (this.isSourceChainSelected()) {
      this.searchResults.handleKeyDown($event);
    }
  }

  trackExplorer(_index: number, explorer: TxTaxiExplorer): string {
    return explorer.id;
  }

  trackCandidate(_index: number, candidate: TxTaxiSearchCandidate): string {
    return `${candidate.chainId}:${candidate.destinationId || ''}:${candidate.objectType}`;
  }

  isSelectedExplorer(explorer: TxTaxiExplorer): boolean {
    const target = this.activeTarget$.value;
    const destinationId = explorer.destinationId || explorer.destinations?.find(destination => destination.default)?.destinationId;
    return target.kind !== 'router' && target.chainId === explorer.chainId
      && target.destinationId === destinationId;
  }

  isSelectedCandidate(candidate: TxTaxiSearchCandidate): boolean {
    const target = this.activeTarget$.value;
    return !this.selectedExplorer() && target.kind !== 'router' && target.chainId === candidate.chainId
      && target.destinationId === candidate.destinationId;
  }

  isOpenedExplorer(explorer: TxTaxiExplorer): boolean {
    return this.isSourceOrigin(explorer.origin);
  }

  selectedExplorer(): TxTaxiExplorer | undefined {
    return this.explorers.find(explorer => explorer.chainId === this.activeTarget$.value.chainId);
  }

  selectedExternalCandidate(): TxTaxiSearchCandidate | undefined {
    const target = this.activeTarget$.value;
    return !this.selectedExplorer() && target.candidate
      ? { ...target.candidate, confirmed: Boolean(target.confirmed), directUrl: target.directUrl }
      : undefined;
  }

  isSelectedExternalCandidate(candidate: TxTaxiSearchCandidate): boolean {
    const selected = this.selectedExternalCandidate();
    return Boolean(selected && selected.chainId === candidate.chainId && selected.destinationId === candidate.destinationId);
  }

  otherExplorers(explorers: TxTaxiExplorer[]): TxTaxiExplorer[] {
    const selected = this.selectedExplorer();
    return explorers.filter(explorer => explorer.chainId !== selected?.chainId);
  }

  childDestinations(explorer: TxTaxiExplorer): TxTaxiExplorer[] {
    return explorer.destinations?.filter(destination => !destination.default) || [];
  }

  additionalExplorersExpanded(explorer: TxTaxiExplorer): boolean {
    return this.additionalExplorerIds.has(explorer.chainId);
  }

  toggleAdditionalExplorers(explorer: TxTaxiExplorer): void {
    if (this.additionalExplorerIds.has(explorer.chainId)) this.additionalExplorerIds.delete(explorer.chainId);
    else this.additionalExplorerIds.add(explorer.chainId);
  }

  private isSourceOrigin(origin: string): boolean {
    if (typeof window === 'undefined') return false;
    const source = this.explorers.find(explorer => explorer.chainId === this.sourceChainId);
    const current = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? source?.origin : window.location.origin;
    try { return Boolean(current && new URL(origin).origin === current); } catch { return false; }
  }

  private selectionChanged(): void {
    this.additionalExplorerIds.clear();
    this.isSearching = false;
    this.setSearchOptions(undefined);
    this.selectionChanges$.next(this.selectionChanges$.value + 1);
    const menu = this.elementRef.nativeElement?.querySelector?.('.search-chain-menu') as HTMLElement | undefined;
    const focusInMenu = typeof document !== 'undefined' && menu?.contains(document.activeElement);
    setTimeout(() => {
      if (!menu) return;
      menu.scrollTop = 0;
      if (focusInMenu) menu.querySelector<HTMLButtonElement>('.search-chain-selected-group .is-current button, .search-chain-selected-group button.search-chain-candidate')?.focus({ preventScroll: true });
    });
  }

  isSourceChainSelected(): boolean {
    const target = this.activeTarget$.value;
    return this.selectedChainId$.value === this.sourceChainId && (!target.origin || this.isSourceOrigin(target.origin));
  }

  isAutomaticRoutingSelected(): boolean {
    return this.manualChainId === undefined && this.activeTarget$.value.kind === 'router';
  }

  selectAutomaticRouting(): void {
    this.manualChainId = undefined;
    this.manualDestinationId = undefined;
    this.hasManualSelection = false;
    this.manualOverrideSearchText = undefined;
    this.manualOverrideTarget = undefined;
    this.selectionChanged();
    this.dropdownHidden = true;
    setTimeout(() => this.dropdownHidden = true);
  }

  selectExplorer(explorer: TxTaxiExplorer): void {
    const destination = explorer.destinations?.find(item => item.default) || explorer.destinations?.[0] || explorer;
    this.manualChainId = destination.chainId;
    this.manualDestinationId = destination.destinationId;
    this.hasManualSelection = true;
    this.manualOverrideSearchText = this.currentSearchText();
    this.manualOverrideTarget = this.targetForExplorer(destination);
    this.selectionChanged();
    this.dropdownHidden = true;
    setTimeout(() => this.dropdownHidden = true);
  }

  selectCandidate(candidate: TxTaxiSearchCandidate): void {
    this.manualChainId = candidate.chainId;
    this.manualDestinationId = candidate.destinationId;
    this.hasManualSelection = true;
    this.manualOverrideSearchText = this.currentSearchText();
    this.manualOverrideTarget = this.targetForCandidate(candidate);
    this.selectionChanged();
    this.dropdownHidden = true;
    setTimeout(() => this.dropdownHidden = true);
  }

  private focusSearchInputWithoutMenu(): void {
    if (!this.searchInput) return;
    this.suppressMenuOnFocus = true;
    this.searchInput.nativeElement.focus();
    this.suppressMenuOnFocus = false;
  }

  onSearchInputFocus(): void {
    if (!this.suppressMenuOnFocus) this.showSourceSuggestions();
  }

  showSourceSuggestions(): void {
    this.chainMenu?.open();
    if (document.activeElement !== this.searchInput?.nativeElement) {
      this.searchInput?.nativeElement.focus();
    }
    this.dropdownHidden = !this.isSourceChainSelected();
  }

  itemSelected(): void {
    setTimeout(() => this.search());
  }

  selectedResult(result: any): void {
    if (!this.isSourceChainSelected()) {
      if (typeof result === 'string') {
        this.search(result);
      }
      return;
    }

    if (typeof result === 'string') {
      this.search(result);
    } else if (typeof result === 'number' && Number.isInteger(result) && result >= 0) {
      this.navigate('/block/', result.toString());
    } else if (result.alias) {
      this.navigate('/lightning/node/', result.public_key);
    } else if (result.short_id) {
      this.navigate('/lightning/channel/', result.id);
    } else if (result.network) {
      if (result.isNetworkAvailable) {
        this.navigate('/address/', result.address, undefined, result.network);
      } else {
        this.searchForm.setValue({
          searchText: '',
        });
        this.isSearching = false;
      }
    } else if (result.slug) {
      this.navigate('/mining/pool/', result.slug);
    }
  }

  search(result?: string): void {
    const searchText = result || this.searchForm.value.searchText.trim();
    if (!searchText) {
      return;
    }

    if (this.regexBlockheight.test(searchText) && this.activeTarget$.value.destinationId !== 'lightning' && (!this.currentManualTarget(searchText) || this.currentManualTarget(searchText)?.chainId === this.sourceChainId)) {
      this.searchSourceChain(searchText);
      return;
    }

    const manualTarget = this.currentManualTarget(searchText);
    if (manualTarget) {
      this.searchTarget(manualTarget, searchText);
      return;
    }

    const resolvedCandidate = this.resolvedCandidate();
    if (resolvedCandidate) {
      this.searchTarget(this.targetForCandidate(resolvedCandidate), searchText);
      return;
    }

    if (this.searchOptions?.input === searchText && this.searchOptions.phase === 'resolved' && this.searchOptions.candidates.length) {
      this.searchRouter(searchText);
      return;
    }

    this.isSearching = true;
    this.querySearchOptions(searchText, true).subscribe((options) => {
      if (this.currentSearchText() !== searchText) {
        this.isSearching = false;
        return;
      }

      if (options) {
        this.setSearchOptions(options);
      }

      const currentManualTarget = this.currentManualTarget(searchText);
      if (currentManualTarget) {
        this.searchTarget(currentManualTarget, searchText);
      } else if (this.resolvedCandidate()) {
        this.searchTarget(this.targetForCandidate(this.resolvedCandidate()!), searchText);
      } else if (options?.candidates.length) {
        this.searchRouter(searchText);
      } else {
        this.searchSourceChain(searchText);
      }
    });
  }

  private searchSourceChain(searchText: string): void {
    this.isSearching = true;
    // Litecoin block hashes have no Bitcoin proof-of-work prefix pattern.
    if (/^[a-fA-F0-9]{64}$/.test(searchText)) {
      this.electrsApiService.getBlock$(searchText).subscribe({
        next: block => this.navigate('/block/', searchText, {state: {data: {block}}}),
        error: error => {
          if (error.status === 404) this.navigate('/tx/', searchText);
          else { this.isSearching = false; this.searchRouter(searchText); }
        },
      });
      return;
    }

    if (!this.regexTransaction.test(searchText) && this.regexAddress.test(searchText)) {
      this.navigate('/address/', searchText);
    } else if (this.regexBlockhash.test(searchText)) {
      this.navigate('/block/', searchText);
    } else if (this.regexBlockheight.test(searchText)) {
      // The block endpoint validates existence; search must work before the live tip arrives.
      this.navigate('/block/', searchText);
    } else if (this.regexTransaction.test(searchText)) {
      const matches = this.regexTransaction.exec(searchText);
      if (this.network === 'liquid' || this.network === 'liquidtestnet') {
        if (this.assets[matches[0]]) {
          this.navigate('/assets/asset/', matches[0]);
        }
        this.electrsApiService.getAsset$(matches[0])
          .subscribe(
            () => { this.navigate('/assets/asset/', matches[0]); },
            () => {
              this.electrsApiService.getBlock$(matches[0])
                .subscribe(
                  (block) => { this.navigate('/block/', matches[0], { state: { data: { block } } }); },
                  () => { this.navigate('/tx/', matches[0]); });
            }
          );
      } else {
        this.navigate('/tx/', matches[0]);
      }
    } else if (this.regexDate.test(searchText) || this.regexUnixTimestamp.test(searchText)) {
      let timestamp: number;
      this.regexDate.test(searchText) ? timestamp = Math.floor(new Date(searchText).getTime() / 1000) : timestamp = Number(searchText);
      // Check if timestamp is too far in the future or before the genesis block
      if (timestamp > Math.floor(Date.now() / 1000)) {
        this.isSearching = false;
        return;
      }
      this.apiService.getBlockDataFromTimestamp$(timestamp).subscribe(
        (data) => { this.navigate('/block/', data.hash); },
        (error) => { console.log(error); this.isSearching = false; }
      );
    } else {
      this.isSearching = false;
    }
  }

  private assignDestination(value: string, destinationHint?: Pick<SearchTarget, 'chainId' | 'destinationId'>): void {
    let lightning = false;
    try {
      const url = new URL(value);
      const registered = this.explorers.find(explorer => explorer.chainId === 'bitcoin')?.destinations?.find(destination => destination.destinationId === 'lightning');
      const routerOrigin = new URL(this.explorerRegistry.hubUrl).origin;
      const scopedForward = destinationHint?.chainId === 'bitcoin' && destinationHint.destinationId === 'lightning'
        && url.origin === routerOrigin && url.pathname.startsWith('/bitcoin/') && url.searchParams.get('destination') === 'lightning';
      lightning = Boolean(registered && !url.username && !url.password && (new URL(registered.origin).origin === url.origin || scopedForward));
    } catch { /* Only registry-owned destinations can animate into Lightning. */ }
    const transition = (window as Window & { txTaxiLightningNavigate?: (url: string) => Promise<void> }).txTaxiLightningNavigate;
    if (lightning && transition) { void transition(value); return; }
    window.location.assign(value);
  }

  private searchTarget(target: SearchTarget, searchText: string): void {
    if (target.destinationId && !target.destinationDefault) {
      this.isSearching = true;
      this.searchTriggered.emit();
      this.assignDestination(target.kind === 'candidate' && target.confirmed && target.directUrl
        ? this.explorerRegistry.navigationUrl(target.directUrl)
        : this.explorerRegistry.chainSearchUrl(target.chainId!, searchText, target.destinationId), target);
      return;
    }
    if (target.kind === 'explorer' && (!target.destinationId || target.destinationDefault) && target.chainId === this.sourceChainId && (!target.origin || this.isSourceOrigin(target.origin))) {
      this.searchSourceChain(searchText);
      return;
    }

    this.isSearching = true;
    this.searchTriggered.emit();
    if (target.kind === 'candidate' && target.confirmed && target.directUrl) {
      const destination = new URL(target.directUrl, window.location.origin);
      const entity = destination.pathname.match(/^\/(tx|block|address)\/([a-zA-Z0-9]+)$/);
      if (target.chainId === this.sourceChainId && entity) {
        this.navigate('/' + entity[1] + '/', entity[2]);
      } else if (entity && destination.protocol === 'https:' && destination.hostname === {
        bitcoin: 'btc.tx.taxi', ethereum: 'eth.tx.taxi', monero: 'xmr.tx.taxi',
        litecoin: 'ltc.tx.taxi', 'bitcoin-cash': 'bch.tx.taxi', dash: 'dash.tx.taxi', dogecoin: 'doge.tx.taxi',
      }[target.chainId || '']) {
        window.location.assign(destination.href);
      } else {
        this.searchRouter(searchText);
      }
      return;
    }

    if (target.chainId) {
      this.assignDestination(this.explorerRegistry.chainSearchUrl(target.chainId, searchText, target.destinationId), target);
      return;
    }

    this.searchRouter(searchText);
  }

  private searchRouter(searchText: string): void {
    this.isSearching = true;
    this.searchTriggered.emit();
    window.location.assign(this.explorerRegistry.routerSearchUrl(searchText, this.sourceChainId));
  }

  private clearManualOverrideOnInputChange(searchText: string): void {
    if (this.manualOverrideSearchText !== undefined && this.manualOverrideSearchText !== searchText) {
      this.manualOverrideSearchText = undefined;
      this.manualOverrideTarget = undefined;
    }
    this.setSearchOptions(undefined);
  }

  private currentSearchText(): string {
    return this.searchForm?.value?.searchText?.trim() || '';
  }

  private currentManualTarget(searchText = this.currentSearchText()): SearchTarget | undefined {
    return this.manualOverrideSearchText === searchText && this.manualOverrideTarget
      ? this.manualOverrideTarget
      : this.hasManualSelection ? this.defaultSearchTarget() : undefined;
  }

  private resolvedCandidate(): TxTaxiSearchCandidate | undefined {
    if (!this.searchOptions?.resolvedChainId || this.searchOptions.phase !== 'resolved' || this.searchOptions.input !== this.currentSearchText()) {
      return undefined;
    }

    return this.searchOptions.candidates.find(
      (candidate) => candidate.chainId === this.searchOptions?.resolvedChainId
        && (!this.searchOptions?.resolvedDestinationId || candidate.destinationId === this.searchOptions.resolvedDestinationId) && candidate.confirmed && candidate.confidence === 'strong' && Boolean(candidate.directUrl),
    );
  }

  private setSearchOptions(options: TxTaxiSearchOptions | undefined): void {
    if (
      options
      && this.searchOptions?.input === options.input
      && this.searchOptions.phase === 'resolved'
      && options.phase === 'classified'
    ) {
      return;
    }

    this.searchOptions = options;
    this.searchOptions$.next(options);
    this.updateActiveTarget();
  }

  private updateActiveTarget(): void {
    const manualTarget = this.currentManualTarget();
    const resolvedCandidate = manualTarget ? undefined : this.resolvedCandidate();
    const hasCandidates = !manualTarget && Boolean(this.searchOptions?.candidates.length);
    const target = manualTarget
      ?? (resolvedCandidate ? this.targetForCandidate(resolvedCandidate) : undefined)
      ?? (hasCandidates ? this.routerSearchTarget : this.defaultSearchTarget());
    const selectedChainId = manualTarget ? target.chainId : hasCandidates ? undefined : target.chainId;

    const activeTarget = this.activeTarget$.value;
    if (
      activeTarget.kind !== target.kind
      || activeTarget.chainId !== target.chainId
      || activeTarget.destinationId !== target.destinationId
      || activeTarget.origin !== target.origin
      || activeTarget.accentColor !== target.accentColor
      || activeTarget.directUrl !== target.directUrl
    ) {
      this.activeTarget$.next(target);
    }
    if (this.selectedChainId$.value !== selectedChainId || activeTarget.destinationId !== target.destinationId || activeTarget.origin !== target.origin) {
      this.selectedChainId$.next(selectedChainId);
    }
  }

  private defaultSearchTarget(): SearchTarget {
    if (this.manualChainId === undefined) return this.routerSearchTarget;
    const explorer = this.explorers.find((candidate) => candidate.chainId === this.manualChainId);
    const destination = explorer?.destinations?.find(item => item.destinationId === this.manualDestinationId)
      || explorer?.destinations?.find(item => item.default) || explorer;
    return destination ? this.targetForExplorer(destination) : {
      kind: 'explorer',
      chainId: this.sourceChainId,
      name: 'Litecoin',
      accentColor: this.defaultChainAccent,
      iconUrl: this.defaultChainIconUrl,
      iconAlt: this.defaultChainIconAlt,
      searchPlaceholder: this.defaultSearchPlaceholder,
    };
  }

  private targetForExplorer(explorer: TxTaxiExplorer): SearchTarget {
    return {
      kind: 'explorer',
      chainId: explorer.chainId,
      destinationId: explorer.destinationId,
      destinationDefault: explorer.default,
      origin: explorer.origin,
      name: explorer.destinationId && !explorer.default ? `${this.explorers.find(item => item.chainId === explorer.chainId)?.name || explorer.symbol} · ${explorer.name}` : this.explorers.find(item => item.chainId === explorer.chainId)?.name || explorer.name,
      accentColor: explorer.accentColor,
      iconUrl: explorer.iconUrl,
      iconAlt: explorer.iconAlt,
      searchPlaceholder: explorer.searchPlaceholder,
    };
  }

  private targetForCandidate(candidate: TxTaxiSearchCandidate): SearchTarget {
    return {
      kind: 'candidate',
      chainId: candidate.chainId,
      destinationId: candidate.destinationId,
      destinationDefault: candidate.destinationDefault,
      origin: candidate.directUrl ? new URL(candidate.directUrl).origin : candidate.host ? `https://${candidate.host}` : undefined,
      candidate,
      name: candidate.destinationName && !candidate.destinationDefault ? `${candidate.name} · ${candidate.destinationName}` : candidate.name,
      accentColor: candidate.accentColor,
      iconUrl: candidate.iconUrl,
      iconAlt: candidate.iconAlt,
      searchPlaceholder: `Search ${candidate.name}`,
      confirmed: candidate.confirmed,
      directUrl: candidate.directUrl,
    };
  }

  private readonly routerSearchTarget: SearchTarget = {
    kind: 'router',
    name: 'tx.taxi',
    accentColor: '#ffd21f',
    iconUrl: 'https://tx.taxi/assets/brand/router-favicon.svg',
    iconAlt: 'tx.taxi',
    searchPlaceholder: 'Search any supported chain',
  };


  navigate(url: string, searchText: string, extras?: any, swapNetwork?: string) {
    if (needBaseModuleChange(this.env.BASE_MODULE as 'liquid' | 'mempool', swapNetwork as Network)) {
      window.location.href = getTargetUrl(swapNetwork as Network, searchText, this.env);
    } else {
      this.router.navigate([this.relativeUrlPipe.transform(url, swapNetwork), searchText], extras);
      this.searchTriggered.emit();
      this.searchForm.setValue({
        searchText: '',
      });
      this.isSearching = false;
    }
  }

  getMiningPools(): Observable<any> {
    return this.pools.length ? of(this.pools) : combineLatest([
      this.apiService.listPools$(undefined),
      this.apiService.listPools$('1y')
    ]).pipe(
      map(([poolsResponse, activePoolsResponse]) => {
        const activePoolSlugs = new Set(activePoolsResponse.body.pools.map(pool => pool.slug));

        return poolsResponse.body.map(pool => ({
          name: pool.name,
          slug: pool.slug,
          active: activePoolSlugs.has(pool.slug)
        }))
          // Sort: active pools first, then alphabetically
          .sort((a, b) => {
            if (a.active && !b.active) {return -1;}
            if (!a.active && b.active) {return 1;}
            return a.slug < b.slug ? -1 : 1;
          });

      }),
      catchError(() => of([]))
    );
  }
}
