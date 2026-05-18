import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return API health payload', () => {
      const result = appController.healthCheck();

      expect(result).toEqual(
        expect.objectContaining({
          status: 'ok',
          message: 'Proyekto API is running',
          environment: expect.any(String),
          timestamp: expect.any(String),
        }),
      );

      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
