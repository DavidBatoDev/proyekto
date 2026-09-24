import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_RECURRENCES,
  type ExpenseCategory,
  type ExpenseRecurrence,
} from '../expense-rollup';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a YYYY-MM-DD date';
const MAX_AMOUNT = 999_999_999_999.99; // numeric(14,2)

export class ListFinanceExpensesQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: `from ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: `to ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  // A string on purpose: the global pipe's implicit conversion would turn
  // "false" into boolean true.
  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  include_voided?: string;
}

export class CreateFinanceExpenseDto {
  @IsIn(EXPENSE_CATEGORIES)
  category!: ExpenseCategory;

  @IsString()
  @Length(1, 300)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendor?: string | null;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(MAX_AMOUNT)
  amount!: number;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency!: string;

  @Matches(DATE_ONLY, { message: `incurred_on ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  incurred_on!: string;

  @IsOptional()
  @IsIn(EXPENSE_RECURRENCES)
  recurrence?: ExpenseRecurrence;

  @IsOptional()
  @Matches(DATE_ONLY, { message: `recurrence_ends_on ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  recurrence_ends_on?: string | null;

  @IsOptional()
  @IsUUID()
  project_id?: string | null;

  @IsOptional()
  @IsUUID()
  document_id?: string | null;
}

/**
 * Partial update. Required-on-create fields may be omitted but never nulled
 * (`ValidateIf` rejects an explicit null); the nullable ones accept null to
 * clear.
 */
export class UpdateFinanceExpenseDto {
  @ValidateIf((o: UpdateFinanceExpenseDto) => o.category !== undefined)
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @ValidateIf((o: UpdateFinanceExpenseDto) => o.description !== undefined)
  @IsString()
  @Length(1, 300)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendor?: string | null;

  @ValidateIf((o: UpdateFinanceExpenseDto) => o.amount !== undefined)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(MAX_AMOUNT)
  amount?: number;

  @ValidateIf((o: UpdateFinanceExpenseDto) => o.currency !== undefined)
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ValidateIf((o: UpdateFinanceExpenseDto) => o.incurred_on !== undefined)
  @Matches(DATE_ONLY, { message: `incurred_on ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  incurred_on?: string;

  @ValidateIf((o: UpdateFinanceExpenseDto) => o.recurrence !== undefined)
  @IsIn(EXPENSE_RECURRENCES)
  recurrence?: ExpenseRecurrence;

  @IsOptional()
  @Matches(DATE_ONLY, { message: `recurrence_ends_on ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  recurrence_ends_on?: string | null;

  @IsOptional()
  @IsUUID()
  project_id?: string | null;

  @IsOptional()
  @IsUUID()
  document_id?: string | null;
}
