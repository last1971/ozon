import { Injectable } from '@nestjs/common';
import { CalculateLossReportCommand } from '../../marketplace-loss/loss.commands';

@Injectable()
export class CalculateWbLossReportCommand extends CalculateLossReportCommand {}
