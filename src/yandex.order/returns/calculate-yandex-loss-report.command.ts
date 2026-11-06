import { Injectable } from '@nestjs/common';
import { CalculateLossReportCommand } from '../../marketplace-loss/loss.commands';

@Injectable()
export class CalculateYandexLossReportCommand extends CalculateLossReportCommand {}
