import { Test } from '@nestjs/testing';
import { FeaturedCardsController } from './featured-cards.controller';
import { FeaturedCardsService } from './featured-cards.service';

describe('FeaturedCardsController', () => {
  let controller: FeaturedCardsController;
  const featuredCardsService = { getPublic: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [FeaturedCardsController],
      providers: [
        { provide: FeaturedCardsService, useValue: featuredCardsService },
      ],
    }).compile();

    controller = moduleRef.get(FeaturedCardsController);
  });

  it('GET /featured-cards returns the public cards', async () => {
    const cards = [
      {
        slot: 1,
        slug: 'neck-pillow-2-0',
        imagePosition: 'left',
        promo: 'BOGO 50% OFF',
      },
    ];
    featuredCardsService.getPublic.mockResolvedValue(cards);

    await expect(controller.findAll()).resolves.toBe(cards);
  });
});
