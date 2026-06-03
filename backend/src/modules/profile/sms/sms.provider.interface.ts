export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface ISmsProvider {
  sendSms(to: string, body: string): Promise<void>;
}
