import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { SeoService } from '@app/services/seo.service';

@Component({
  selector: 'app-about',
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutComponent implements OnInit {
  constructor(
    private seoService: SeoService,
  ) { }

  ngOnInit(): void {
    this.seoService.setTitle($localize`:@@taxi.ltc.nav.about:About ltc.tx.taxi`);
    this.seoService.setDescription($localize`:@@taxi.ltc.about.description:Learn about ltc.tx.taxi, a Litecoin block and mempool explorer in the tx.taxi multi-chain family.`);
  }
}
