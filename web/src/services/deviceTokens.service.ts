import apiClient from "@/api/axios";

export type DevicePlatform = "ios" | "android" | "web";

export interface RegisterDeviceTokenInput {
  token: string;
  platform: DevicePlatform;
  deviceId?: string;
  appVersion?: string;
}

/**
 * Device-token registry for FCM push. Talks to the backend PushModule
 * (`/api/push/tokens`), which persists one row per device token (UNIQUE token,
 * many per user). Auth (Supabase JWT) is attached by the axios interceptor.
 */
class DeviceTokensService {
  private base = "/api/push/tokens";

  async register(input: RegisterDeviceTokenInput): Promise<void> {
    await apiClient.post(this.base, {
      token: input.token,
      platform: input.platform,
      device_id: input.deviceId,
      app_version: input.appVersion,
    });
  }

  /**
   * Unregister this device's token (logout cleanup). DELETE carries the token in
   * the body. Must run while the user is still authenticated.
   */
  async unregister(token: string): Promise<void> {
    await apiClient.delete(this.base, { data: { token } });
  }
}

export const deviceTokensService = new DeviceTokensService();
