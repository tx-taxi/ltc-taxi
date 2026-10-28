import { Component } from '@angular/core';
import { SeoService } from '@app/services/seo.service';

@Component({
  selector: 'app-privacy-policy',
  templateUrl: './privacy-policy.component.html',
  styleUrls: ['./privacy-policy.component.scss'],
  standalone: false,
})
export class PrivacyPolicyComponent {
  constructor(
    private seoService: SeoService,
  ) { }

  ngOnInit(): void {
    this.seoService.setTitle($localize`:@@taxi.ltc.privacy.title:Privacy Policy`);
    this.seoService.setDescription($localize`:@@taxi.ltc.privacy.description:Privacy notes for ltc.tx.taxi, including public Litecoin data, browser preferences, server logs, and independent verification.`);
  }
}
