import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  type AdminFeaturedCardView,
  FeaturedCardsService,
} from '../products/featured-cards.service';
import { AdminGuard } from './admin.guard';
import {
  FeaturedCardSlotParamDto,
  UpdateFeaturedCardDto,
} from './dto/featured-card-dtos';

// The two large product cards on the Shop page. Only the card settings
// (product, image side, promo) are saved here; the admin app saves the
// product's details with PATCH /admin/products/:slug first.
@Controller('admin/featured-cards')
@UseGuards(AdminGuard)
export class AdminFeaturedCardsController {
  constructor(private readonly featuredCardsService: FeaturedCardsService) {}

  @Get()
  findAll(): Promise<AdminFeaturedCardView[]> {
    return this.featuredCardsService.getForAdmin();
  }

  @Patch(':slot')
  update(
    @Param() { slot }: FeaturedCardSlotParamDto,
    @Body() dto: UpdateFeaturedCardDto,
  ): Promise<AdminFeaturedCardView> {
    return this.featuredCardsService.updateCard(slot, dto);
  }
}
