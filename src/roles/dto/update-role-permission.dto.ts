import { IsBoolean, IsEnum } from 'class-validator';
import { Screen, UserRole } from '@prisma/client';

export class UpdateRolePermissionDto {
  @IsEnum(UserRole)
  role!: UserRole;

  @IsEnum(Screen)
  screen!: Screen;

  @IsBoolean()
  canRead!: boolean;

  @IsBoolean()
  canWrite!: boolean;
}
