import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

// Sends transactional email through Brevo. Knows nothing about orders:
// each feature builds its own email content and calls EmailService.send().
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
