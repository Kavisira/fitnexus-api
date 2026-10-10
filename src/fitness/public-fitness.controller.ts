import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FitnessService } from './fitness.service';
import { LogWorkoutSetDto, LogWorkoutSetsBulkDto } from './dto/log-workout-set.dto';

/** Deliberately unauthenticated — same token-only model as
 * PublicFormsController (see its doc comment). The token here is
 * persistent/bookmarkable rather than single-use, since this page is
 * meant to be revisited. */
@Controller('public/fitness')
export class PublicFitnessController {
  constructor(private fitnessService: FitnessService) {}

  @Get(':token')
  getPlans(@Param('token') token: string) {
    return this.fitnessService.getPublicPlans(token);
  }

  @Post(':token/sets')
  logSet(@Param('token') token: string, @Body() dto: LogWorkoutSetDto) {
    return this.fitnessService.logSetAsMember(token, dto);
  }

  @Post(':token/sets/bulk')
  logSetsBulk(@Param('token') token: string, @Body() dto: LogWorkoutSetsBulkDto) {
    return this.fitnessService.logSetsAsMember(token, dto);
  }
}
