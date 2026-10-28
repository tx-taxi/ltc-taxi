import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { StorageService } from '@app/services/storage.service';
import { fiatCurrencies } from '@app/app.constants';
import { StateService } from '@app/services/state.service';
import { writeSharedPreference } from '@app/services/shared-preferences';

@Component({
  selector: 'app-fiat-selector',
  templateUrl: './fiat-selector.component.html',
  styleUrls: ['./fiat-selector.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class FiatSelectorComponent implements OnInit {
  fiatForm: UntypedFormGroup;
  reference$ = this.stateService.fiatReference$.asObservable();
  currencies = Object.entries(fiatCurrencies).sort((a: any, b: any) => {
    if (a[1].code < b[1].code) {
      return -1;
    }
    if (a[1].code > b[1].code) {
      return 1;
    }
    return 0;
  });

  constructor(
    private formBuilder: UntypedFormBuilder,
    private stateService: StateService,
    private storageService: StorageService,
  ) { }

  referenceTitle(stale: boolean): string {
    return stale ? $localize`:@@taxi.ltc.fiat.reference-stale:ECB reference rate; update unavailable` : $localize`:@@taxi.ltc.fiat.reference:ECB reference rate`;
  }

  ngOnInit() {
    this.fiatForm = this.formBuilder.group({
      fiat: ['USD']
    });
    this.stateService.fiatCurrency$.subscribe((fiat) => {
      this.fiatForm.get('fiat')?.setValue(fiat);
    });
    if (!this.stateService.env.ADDITIONAL_CURRENCIES) {
      this.currencies = this.currencies.filter((currency: any) => {
        return ['AUD', 'CAD', 'EUR', 'JPY', 'GBP', 'CHF', 'USD'].includes(currency[0]);
      });
    }
  }

  changeFiat() {
    const newFiat = this.fiatForm.get('fiat')?.value;
    if (!this.currencies.some(([key]) => key === newFiat)) { return; }
    this.storageService.setValue('fiat-preference', newFiat);
    writeSharedPreference(document, 'txtaxi_currency', newFiat);
    this.stateService.fiatCurrency$.next(newFiat);
  }
}
