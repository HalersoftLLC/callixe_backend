import { Controller, Get } from '@nestjs/common';
import {
  FeaturedCardsService,
  type PublicFeaturedCard,
} from './featured-cards.service';

// Public, read-only. The storefront matches each card's slug to the products
// from GET /products and falls back to its own layout if this request fails.
@Controller('featured-cards')
export class FeaturedCardsController {
  constructor(private readonly featuredCardsService: FeaturedCardsService) {}

  @Get()
  findAll(): Promise<PublicFeaturedCard[]> {
    return this.featuredCardsService.getPublic();
  }
}
