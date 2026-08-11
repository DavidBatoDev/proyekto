import { ConsultantApplication } from '../../../../common/entities';
import { CreateApplicationDto } from '../dto/application.dto';

export interface ApplicationsRepository {
  findByUser(userId: string): Promise<ConsultantApplication | null>;
  upsert(
    userId: string,
    dto: CreateApplicationDto,
  ): Promise<ConsultantApplication>;
  submit(userId: string): Promise<ConsultantApplication>;
}
