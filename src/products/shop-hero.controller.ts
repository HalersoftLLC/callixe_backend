import { Controller, Get } from '@nestjs/common';
import { type ShopHeroView, ShopHeroService } from './shop-hero.service';

// Public, read-only. The storefront falls back to its own text and image if
// this request fails, so the Shop page never breaks.
@Controller('shop-hero')
export class ShopHeroController {
  constructor(private readonly shopHeroService: ShopHeroService) {}

  @Get()
  find(): Promise<ShopHeroView> {
    return this.shopHeroService.getPublic();
  }
}
