import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyseEntryUseCase } from '../application/analyse-entry/analyse-entry.use-case.js';
@Injectable()
export class AnalysisWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AnalyseEntryUseCase) private readonly analyse: AnalyseEntryUseCase,
  ) {}
  onModuleInit(): void {
    if (
      this.config.get('AI_WORKER_ENABLED') !== 'true' ||
      !this.config.get('OPENROUTER_API_KEY')
    )
      return;
    this.timer = setInterval(() => {
      if (!this.running)
        this.running = this.tick().finally(() => {
          this.running = undefined;
        });
    }, 5000);
    this.timer.unref();
  }
  private async tick(): Promise<void> {
    try {
      await this.analyse.execute();
    } catch {
      this.logger.error('AI worker iteration failed; work will be retried');
    }
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
