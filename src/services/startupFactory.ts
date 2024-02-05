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
  constructor(logger?: LoggerService) {
    switch (startupConfig.startupType) {
      case 'jetstream':
        this.startupService = new JetstreamService(logger);
        break;
      case 'nats':
        this.startupService = new NatsService(logger);
        break;
      default:
        throw new Error('STARTUP_TYPE not set to a correct value.');
    }
  }

  /* eslint-disable @typescript-eslint/no-misused-promises */
  async init(onMessage: onMessageFunction, parConsumerStreamNames?: string[], parProducerStreamName?: string): Promise<boolean> {
    process.on('uncaughtException', async (): Promise<void> => {
      await this.startupService.init(onMessage, parConsumerStreamNames, parProducerStreamName);
    });

    process.on('unhandledRejection', async (): Promise<void> => {
      await this.startupService.init(onMessage, parConsumerStreamNames, parProducerStreamName);
    });

    return await this.startupService.init(onMessage, parConsumerStreamNames, parProducerStreamName);
  }

  async initProducer(parProducerStreamName?: string): Promise<boolean> {
    process.on('uncaughtException', async (): Promise<void> => {
      await this.startupService.initProducer(parProducerStreamName);
    });

    process.on('unhandledRejection', async (): Promise<void> => {
      await this.startupService.initProducer(parProducerStreamName);
    });

    return await this.startupService.initProducer(parProducerStreamName);
  }

  async handleResponse(response: object, subject?: string[] | undefined): Promise<void> {
    await this.startupService.handleResponse(response, subject);
  }
}
