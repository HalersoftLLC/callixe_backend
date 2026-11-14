import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/validation/transforms';
import { DISCOUNT_CODE_MAX_LENGTH } from '../orders.constants';

export class ValidateDiscountDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(DISCOUNT_CODE_MAX_LENGTH)
  code!: string;
}
