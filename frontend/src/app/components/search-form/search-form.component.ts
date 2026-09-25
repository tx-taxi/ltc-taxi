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
  private explorers: TxTaxiExplorer[] = [];
  private manualChainId = this.sourceChainId;
  private manualOverrideSearchText: string | undefined;
  private manualOverrideTarget: SearchTarget | undefined;
  private searchOptions: TxTaxiSearchOptions | undefined;

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
      return this.explorerRegistry.searchOptions$(searchText, probe, this.sourceChainId).pipe(
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
        setTimeout(() => this.searchInput.nativeElement.focus(), 100);
      } else if (this.searchInput) {
        this.searchInput.nativeElement.focus();
      }
    });

    this.searchForm = this.formBuilder.group({
      searchText: ['', Validators.required],
    });

    this.explorers$.subscribe((explorers) => {
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

    searchText$.pipe(
      debounceTime(120),
      switchMap((searchText) => this.querySearchOptions(searchText).pipe(
        map((options) => ({ searchText, options })),
      )),
    ).subscribe(({ searchText, options }) => {
      if (options && this.currentSearchText() === searchText) {
        this.setSearchOptions(options);
      }
    });

    searchText$.pipe(
      debounceTime(420),
      switchMap((searchText) => this.querySearchOptions(searchText, true).pipe(
        map((options) => ({ searchText, options })),
      )),
    ).subscribe(({ searchText, options }) => {
      if (options && this.currentSearchText() === searchText) {
        this.setSearchOptions(options);
      }
    });

    const sourceSearchText$ = combineLatest([searchText$, this.selectedChainId$]).pipe(
      map(([searchText, chainId]) => chainId === this.sourceChainId ? searchText : ''),
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
    return explorer.chainId;
  }

  trackCandidate(_index: number, candidate: TxTaxiSearchCandidate): string {
    return candidate.chainId;
  }

  isSelectedExplorer(explorer: TxTaxiExplorer): boolean {
    return explorer.chainId === this.manualChainId
      && (!this.searchOptions?.candidates.length || this.currentManualTarget()?.kind === 'explorer');
  }

  isSelectedCandidate(candidate: TxTaxiSearchCandidate): boolean {
    const target = this.activeTarget$.value;
    return target.kind === 'candidate' && target.chainId === candidate.chainId;
  }

  isSourceChainSelected(): boolean {
    return this.selectedChainId$.value === this.sourceChainId;
  }

  selectExplorer(explorer: TxTaxiExplorer): void {
    this.manualChainId = explorer.chainId;
    this.manualOverrideSearchText = this.currentSearchText();
    this.manualOverrideTarget = this.targetForExplorer(explorer);
    this.updateActiveTarget();
    this.dropdownHidden = true;
    setTimeout(() => this.dropdownHidden = true);
  }

  selectCandidate(candidate: TxTaxiSearchCandidate): void {
    this.manualOverrideSearchText = this.currentSearchText();
    this.manualOverrideTarget = this.targetForCandidate(candidate);
    this.updateActiveTarget();
    this.dropdownHidden = true;
    setTimeout(() => this.dropdownHidden = true);
  }

  showSourceSuggestions(): void {
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

    if (this.regexBlockheight.test(searchText) && (!this.currentManualTarget(searchText) || this.currentManualTarget(searchText)?.chainId === this.sourceChainId)) {
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

  private searchTarget(target: SearchTarget, searchText: string): void {
    if (target.kind === 'explorer' && target.chainId === this.sourceChainId) {
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
      } else if (entity && ['bitcoin', 'ethereum', 'monero'].includes(target.chainId || '') && destination.protocol === 'https:' && ['btc.tx.taxi', 'eth.tx.taxi', 'xmr.tx.taxi'].includes(destination.hostname)) {
        this.router.navigate(['/cab', target.chainId, entity[1], entity[2]]);
        this.isSearching = false;
      } else {
        this.searchRouter(searchText);
      }
      return;
    }

    if (target.chainId) {
      window.location.assign(this.explorerRegistry.chainSearchUrl(target.chainId, searchText));
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
    return this.manualOverrideSearchText === searchText ? this.manualOverrideTarget : undefined;
  }

  private resolvedCandidate(): TxTaxiSearchCandidate | undefined {
    if (!this.searchOptions?.resolvedChainId || this.searchOptions.phase !== 'resolved' || this.searchOptions.input !== this.currentSearchText()) {
      return undefined;
    }

    return this.searchOptions.candidates.find(
      (candidate) => candidate.chainId === this.searchOptions?.resolvedChainId && candidate.confirmed && candidate.confidence === 'strong' && Boolean(candidate.directUrl),
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

    if (this.selectedChainId$.value !== selectedChainId) {
      this.selectedChainId$.next(selectedChainId);
    }

    const activeTarget = this.activeTarget$.value;
    if (
      activeTarget.kind !== target.kind
      || activeTarget.chainId !== target.chainId
      || activeTarget.accentColor !== target.accentColor
      || activeTarget.directUrl !== target.directUrl
    ) {
      this.activeTarget$.next(target);
    }
  }

  private defaultSearchTarget(): SearchTarget {
    const explorer = this.explorers.find((candidate) => candidate.chainId === this.manualChainId);
    return explorer ? this.targetForExplorer(explorer) : {
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
      name: explorer.name,
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
      name: candidate.name,
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
    iconUrl: 'https://tx.taxi/assets/brand/taxi-logo.svg',
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
