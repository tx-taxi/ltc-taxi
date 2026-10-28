import { Component } from '@angular/core';
import { SeoService } from '@app/services/seo.service';

@Component({
  selector: 'app-trademark-policy',
  templateUrl: './trademark-policy.component.html',
  styleUrls: ['./trademark-policy.component.scss'],
  standalone: false,
})
export class TrademarkPolicyComponent {
  constructor(
    private seoService: SeoService,
  ) { }

  ngOnInit(): void {
    this.seoService.setTitle($localize`:@@taxi.ltc.trademark.title:Trademark & Attribution`);
    this.seoService.setDescription($localize`:@@taxi.ltc.trademark.description:Trademark and attribution notes for ltc.tx.taxi, including upstream mempool/mempool attribution and project independence.`);
  }
}
