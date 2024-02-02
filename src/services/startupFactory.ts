import { type LoggerService } from '@frmscoe/frms-coe-lib';
import { type IStartupService, type onMessageFunction } from '..';
import { startupConfig } from '../interfaces/iStartupConfig';
import { JetstreamService } from './jetstreamService';
import { NatsService } from './natsService';

export class StartupFactory implements IStartupService {
  startupService: IStartupService;
  /**
   *  Initializes a new startup service which would either be a Jetstream or Nats server, depending on the configurd SERVER_TYPE env variable ('nats' | 'jestream')
   */
  constructor() {
    switch (startupConfig.startupType) {
      case 'jetstream':
        this.startupService = new JetstreamService();
        break;
      case 'nats':
        this.startupService = new NatsService();
        break;
      default:
        throw new Error('STARTUP_TYPE not set to a correct value.');
    }
  }

  /* eslint-disable @typescript-eslint/no-misused-promises */
  async init(
    onMessage: onMessageFunction,
    loggerService?: LoggerService | undefined,
    parConsumerStreamNames?: string[],
    parProducerStreamName?: string,
  ): Promise<boolean> {
    process.on('uncaughtException', async (): Promise<void> => {
      await this.startupService.init(onMessage, loggerService, parConsumerStreamNames, parProducerStreamName);
    });

    process.on('unhandledRejection', async (): Promise<void> => {
      await this.startupService.init(onMessage, loggerService, parConsumerStreamNames, parProducerStreamName);
    });

    return await this.startupService.init(onMessage, loggerService, parConsumerStreamNames, parProducerStreamName);
  }

  async initProducer(loggerService?: LoggerService | undefined, parProducerStreamName?: string): Promise<boolean> {
    process.on('uncaughtException', async (): Promise<void> => {
      await this.startupService.initProducer(loggerService, parProducerStreamName);
    });

    process.on('unhandledRejection', async (): Promise<void> => {
      await this.startupService.initProducer(loggerService, parProducerStreamName);
    });

    return await this.startupService.initProducer(loggerService, parProducerStreamName);
  }

  async handleResponse(response: object, subject?: string[] | undefined): Promise<void> {
    await this.startupService.handleResponse(response, subject);
  }
}
