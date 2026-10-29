import { ChangeDetectionStrategy, Component, Input, Inject, LOCALE_ID } from '@angular/core';

@Component({
  selector: 'app-tx-taxi-docs-intro',
  standalone: true,
  templateUrl: './tx-taxi-docs-intro.component.html',
  styleUrls: ['./tx-taxi-docs-intro.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TxTaxiDocsIntroComponent {
  @Input() context = 'documentation';
  @Input() chainName = '';
  @Input() chainHost = '';

  constructor(@Inject(LOCALE_ID) private locale: string) {}

  get nativeHref(): string {
    const language = this.locale.substring(0, 2);
    return ['es', 'fr', 'de', 'it'].includes(language) ? `/${language}/` : '/';
  }

  get nativeLabel(): string {
    return $localize`:@@taxi.intro.native-label:Open ${this.chainHost}:host:`;
  }

  get contextLabel(): string {
    return this.context === 'explorer'
      ? $localize`:@@taxi.intro.chain-explorer:${this.chainName}:CHAIN: explorer`
      : $localize`:@@taxi.intro.chain-docs:${this.chainName}:CHAIN: documentation`;
  }
}
