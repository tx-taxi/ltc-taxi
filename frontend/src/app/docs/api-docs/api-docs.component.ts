import { Component, OnInit, Input, QueryList, AfterViewInit, ViewChildren } from '@angular/core';
import { Env, StateService } from '@app/services/state.service';
import { Observable, merge, of, Subject, Subscription } from 'rxjs';
import { tap, takeUntil } from 'rxjs/operators';
import { ActivatedRoute } from '@angular/router';
import { litecoinFaqData, litecoinRestApiDocsData, litecoinWsApiDocsData } from '@app/docs/api-docs/litecoin-docs-data';
import { FaqTemplateDirective } from '@app/docs/faq-template/faq-template.component';

@Component({
  selector: 'app-api-docs',
  templateUrl: './api-docs.component.html',
  styleUrls: ['./api-docs.component.scss'],
  standalone: false,
})
export class ApiDocsComponent implements OnInit, AfterViewInit {
  private destroy$: Subject<any> = new Subject<any>();
  hostname = document.location.hostname;
  network$: Observable<string>;
  active = 0;
  env: Env;
  code: any;
  baseNetworkUrl = '';
  @Input() whichTab: string;
  desktopDocsNavPosition = 'sticky';
  faq: any[];
  restDocs: any[];
  wsDocs: any;
  screenWidth: number;
  officialMempoolInstance: boolean;
  runningElectrs: boolean;
  auditEnabled: boolean;
  mobileViewport: boolean = false;
  showMobileEnterpriseUpsell: boolean = true;
  timeLtrSubscription: Subscription;
  timeLtr: boolean = this.stateService.timeLtr.value;
  isMempoolSpaceBuild = this.stateService.isMempoolSpaceBuild;

  @ViewChildren(FaqTemplateDirective) faqTemplates: QueryList<FaqTemplateDirective>;
  dict = {};

  constructor(
    private stateService: StateService,
    private route: ActivatedRoute,
  ) { }

  ngAfterContentChecked() {
    if (this.faqTemplates) {
      this.faqTemplates.forEach((x) => this.dict[x.type] = x.template);
    }
    this.mobileViewport = window.innerWidth <= 992;
  }

  ngAfterViewInit() {
    const that = this;
    setTimeout( () => {
      if( this.route.snapshot.fragment ) {
        this.openEndpointContainer( this.route.snapshot.fragment );
        if (document.getElementById( this.route.snapshot.fragment )) {
          const vOffset = ( window.innerWidth <= 992 ) ? 100 : 60;
          window.scrollTo({
            top: document.getElementById( this.route.snapshot.fragment ).offsetTop - vOffset
          });
        }
      }
      window.addEventListener('scroll', that.onDocScroll, { passive: true });
    }, 1 );
  }

  ngOnInit(): void {
    this.env = this.stateService.env;
    this.officialMempoolInstance = this.env.OFFICIAL_MEMPOOL_SPACE;
    this.stateService.backend$.pipe(takeUntil(this.destroy$)).subscribe((backend) => {
      this.runningElectrs = !!(backend == 'esplora');
    });
    this.auditEnabled = this.env.AUDIT;
    this.network$ = merge(of(''), this.stateService.networkChanged$).pipe(
      tap((network: string) => {
        if (this.env.BASE_MODULE === 'mempool' && network !== '' && this.env.ROOT_NETWORK === '') {
          this.baseNetworkUrl = `/${network}`;
        } else if (this.env.BASE_MODULE === 'liquid') {
          if (!['', 'liquid'].includes(network)) {
            this.baseNetworkUrl = `/${network}`;
          }
        }
        return network;
      })
    );

    if (document.location.port !== '') {
      this.hostname = `${this.hostname}:${document.location.port}`;
    }

    this.hostname = `${document.location.protocol}//${this.hostname}`;

    this.faq = litecoinFaqData;
    this.restDocs = litecoinRestApiDocsData;
    this.wsDocs = litecoinWsApiDocsData;

    this.network$.pipe(takeUntil(this.destroy$)).subscribe((network) => {
      this.active = (network === 'liquid' || network === 'liquidtestnet') ? 2 : 0;
    });

    this.timeLtrSubscription = this.stateService.timeLtr.subscribe((ltr) => {
      this.timeLtr = !!ltr;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next(true);
    this.destroy$.complete();
    window.removeEventListener('scroll', this.onDocScroll);
    this.timeLtrSubscription.unsubscribe();
  }

  onDocScroll() {
    // The documentation introduction changes page height. CSS sticky keeps the
    // sidebar aligned with the tab content without a hard-coded scroll offset.
  }

  anchorLinkClick( e ) {
    const targetId = e.fragment;
    const vOffset = ( window.innerWidth <= 992 ) ? 100 : 60;
    window.scrollTo({
      top: document.getElementById( targetId ).offsetTop - vOffset
    });
    window.history.pushState({}, null, document.location.href.split('#')[0] + '#' + targetId);
    this.openEndpointContainer( targetId );
  }

  openEndpointContainer( targetId ) {
    let tabHeaderHeight = 0;
    if (document.getElementById( targetId + '-tab-header' )) {
      tabHeaderHeight = document.getElementById( targetId + '-tab-header' ).scrollHeight;
    }
    if( ( window.innerWidth <= 992 ) && ( ( this.whichTab === 'rest' ) || ( this.whichTab === 'faq' ) || ( this.whichTab === 'websocket' ) ) && targetId ) {
      const endpointContainerEl = document.querySelector<HTMLElement>( '#' + targetId );
      const endpointContentEl = document.querySelector<HTMLElement>( '#' + targetId + ' .endpoint-content' );
      const endPointContentElHeight = endpointContentEl.clientHeight;

      if( endpointContentEl.classList.contains( 'open' ) ) {
        endpointContainerEl.style.height = 'auto';
        endpointContentEl.style.top = '-10000px';
        endpointContentEl.style.opacity = '0';
        endpointContentEl.classList.remove( 'open' );
      } else {
        endpointContainerEl.style.height = endPointContentElHeight + tabHeaderHeight + 28 + 'px';
        endpointContentEl.style.top = tabHeaderHeight + 28 + 'px';
        endpointContentEl.style.opacity = '1';
        endpointContentEl.classList.add( 'open' );
      }
    }
  }

  wrapUrl(network: string, code: any, websocket: boolean = false) {

    let curlResponse = [];
    if (['', 'mainnet'].includes(network)){
      curlResponse = code.codeSampleMainnet.curl;
    }
    if (network === 'testnet') {
      curlResponse = code.codeSampleTestnet.curl;
    }
    if (network === 'testnet4') {
      curlResponse = code.codeSampleTestnet.curl;
    }
    if (network === 'signet') {
      curlResponse = code.codeSampleSignet.curl;
    }
    if (network === 'liquid') {
      curlResponse = code.codeSampleLiquid.curl;
    }
    if (network === 'liquidtestnet') {
      curlResponse = code.codeSampleLiquidTestnet.curl;
    }
    let curlNetwork = '';
    if (this.env.BASE_MODULE === 'mempool') {
      if (!['', 'mainnet'].includes(network)) {
        curlNetwork = `/${network}`;
      }
    } else if (this.env.BASE_MODULE === 'liquid') {
      if (!['', 'liquid'].includes(network)) {
        curlNetwork = `/${network}`;
      }
    }

    if (network === this.env.ROOT_NETWORK) {
      curlNetwork = '';
    }

    let text = code.codeTemplate.curl;
    for (let index = 0; index < curlResponse.length; index++) {
      const curlText = curlResponse[index];
      const indexNumber = index + 1;
      text = text.replace('%{' + indexNumber + '}', curlText);
    }

    return `${this.hostname}${curlNetwork}${text}`;
  }

  websocketUrl(network: string) {
    let curlNetwork = '';
    if (this.env.BASE_MODULE === 'mempool') {
      if (!['', 'mainnet'].includes(network)) {
        curlNetwork = `/${network}`;
      }
    } else if (this.env.BASE_MODULE === 'liquid') {
      if (!['', 'liquid'].includes(network)) {
        curlNetwork = `/${network}`;
      }
    }

    if (network === this.env.ROOT_NETWORK) {
      curlNetwork = '';
    }

    let wsHostname = this.hostname.replace('https://', 'wss://');
    wsHostname = wsHostname.replace('http://', 'ws://');
    return `${wsHostname}${curlNetwork}/api/v1/ws`;
  }

}
