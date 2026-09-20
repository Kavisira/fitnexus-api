import { IsString, MinLength } from 'class-validator';

export class UploadLogoDto {
  // A data: URL (base64) from the browser's FileReader, same pattern
  // as member photo uploads — see S3Service.uploadOrgLogo.
  @IsString()
  @MinLength(1)
  logoDataUrl!: string;
}
