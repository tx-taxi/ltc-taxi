import { Component } from '@angular/core';
import { SeoService } from '@app/services/seo.service';

@Component({
  selector: 'app-terms-of-service',
  templateUrl: './terms-of-service.component.html',
  standalone: false,
})
export class TermsOfServiceComponent {
  constructor(
    private seoService: SeoService,
  ) { }

  ngOnInit(): void {
    this.seoService.setTitle($localize`:@@taxi.ltc.terms.title:Terms of Service`);
    this.seoService.setDescription($localize`:@@taxi.ltc.terms.description:Terms for using ltc.tx.taxi as an informational Litecoin block and mempool explorer.`);
  }
}
