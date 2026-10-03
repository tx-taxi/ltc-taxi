import { Injectable } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, map, switchMap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { nativeSeoPages, nativeSeoScreenshot } from '@app/shared/native-seo-pages';

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  network = '';
  baseTitle = 'ltc.tx.taxi';
  baseDescription = 'Explore Litecoin blocks, transactions, addresses, fees and mining activity.';
  baseDomain = 'ltc.tx.taxi';

  canonicalLink: HTMLLinkElement = document.getElementById('canonical') as HTMLLinkElement;

  constructor(
    private titleService: Title,
    private metaService: Meta,
    private stateService: StateService,
    private router: Router,
    private activatedRoute: ActivatedRoute,
  ) {
    // save original meta tags
    // A deep link's entity metadata must not become the site's reset defaults.
    try {
      const canonicalUrl = new URL(this.canonicalLink?.href || '');
      this.baseDomain = canonicalUrl?.host;
    } catch (e) {
      // leave as default
    }

    this.stateService.networkChanged$.subscribe((network) => this.network = network);
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.activatedRoute),
      map(route => {
        while (route.firstChild) {route = route.firstChild;}
        return route;
      }),
      filter(route => route.outlet === 'primary'),
      switchMap(route => route.data),
    ).subscribe((data) => {
      this.clearSoft404();
      this.updateCanonical(this.router.url.split('?')[0].split('#')[0]);
      if (this.documentMetadata()) { this.setTitle(''); this.setDescription(''); }
    });
  }

  private documentMetadata() {
    let path = this.router.url.split('?')[0].split('#')[0];
    try { path = decodeURIComponent(path); } catch {}
    return nativeSeoPages[path.replace(/\/$/, '') || '/'];
  }

  setTitle(newTitle: string): void {
    const fullTitle = this.documentMetadata()?.title || newTitle + ' - ' + this.getTitle();
    const imageAlt = nativeSeoScreenshot.alt;
    this.titleService.setTitle(fullTitle);
    this.metaService.updateTag({ property: 'og:title', content: fullTitle});
    this.metaService.updateTag({ name: 'twitter:title', content: fullTitle});
    this.metaService.updateTag({ property: 'og:image:alt', content: imageAlt});
    this.metaService.updateTag({ name: 'twitter:image:alt', content: imageAlt});
    this.metaService.updateTag({ property: 'og:meta:ready', content: 'ready'});
  }

  resetTitle(): void {
    const title = this.documentMetadata()?.title || this.getTitle();
    const imageAlt = nativeSeoScreenshot.alt;
    this.titleService.setTitle(title);
    this.metaService.updateTag({ property: 'og:title', content: title});
    this.metaService.updateTag({ name: 'twitter:title', content: title});
    this.metaService.updateTag({ property: 'og:image:alt', content: imageAlt});
    this.metaService.updateTag({ name: 'twitter:image:alt', content: imageAlt});
    this.metaService.updateTag({ property: 'og:meta:ready', content: 'ready'});
  }

  setEnterpriseTitle(title: string, override: boolean = false) {
    if (override) {
      this.baseTitle = title;
    } else {
      this.baseTitle = title + ' - ' + this.baseTitle;
    }
    this.resetTitle();
  }

  setDescription(newDescription: string): void {
    newDescription = this.documentMetadata()?.description || newDescription;
    this.metaService.updateTag({ name: 'description', content: newDescription});
    this.metaService.updateTag({ name: 'twitter:description', content: newDescription});
    this.metaService.updateTag({ property: 'og:description', content: newDescription});
  }

  resetDescription(): void {
    this.metaService.updateTag({ name: 'description', content: this.getDescription()});
    this.metaService.updateTag({ name: 'twitter:description', content: this.getDescription()});
    this.metaService.updateTag({ property: 'og:description', content: this.getDescription()});
  }

  updateCanonical(path) {
    try { path = decodeURIComponent(path); } catch {}
    path = path.replace(/\/$/, '') || '/';
    const canonicalUrl = 'https://' + this.baseDomain + path;
    this.canonicalLink.setAttribute('href', canonicalUrl);
    this.metaService.updateTag({ property: 'og:url', content: canonicalUrl });
  }

  getTitle(): string {
    if (this.network === 'testnet')
      {return this.baseTitle + ' - Bitcoin Testnet3';}
    if (this.network === 'testnet4')
      {return this.baseTitle + ' - Bitcoin Testnet4';}
    if (this.network === 'signet')
      {return this.baseTitle + ' - Bitcoin Signet';}
    if (this.network === 'liquid')
      {return this.baseTitle + ' - Liquid Network';}
    if (this.network === 'liquidtestnet')
      {return this.baseTitle + ' - Liquid Testnet';}
    return this.baseTitle + ' - ' + (this.network ? this.ucfirst(this.network) : 'Litecoin') + ' Explorer';
  }

  getDescription(): string {
    return this.documentMetadata()?.description || this.baseDescription;
  }

  ucfirst(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  clearSoft404() {
    window['soft404'] = false;
  }

  logSoft404() {
    window['soft404'] = true;
  }
}
