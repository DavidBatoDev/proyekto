import { Injectable, Logger } from '@nestjs/common';
import type { ISmsProvider } from './sms.provider.interface';

@Injectable()
export class ConsoleSmsProvider implements ISmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async sendSms(to: string, body: string): Promise<void> {
    this.logger.log(`[SMS] To: ${to} | Message: ${body}`);
  }
}
