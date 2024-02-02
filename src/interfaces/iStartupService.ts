// init, initProducer, handleResponse

import { type LoggerService } from '@frmscoe/frms-coe-lib';
import { type onMessageFunction } from '../types/onMessageFunction';

export interface IStartupService {
  init: (
    onMessage: onMessageFunction,
    loggerService?: LoggerService,
    parConsumerStreamNames?: string[],
    parProducerStreamName?: string,
  ) => Promise<boolean>;
  initProducer: (loggerService?: LoggerService, parProducerStreamName?: string) => Promise<boolean>;
  handleResponse: (response: object, subject?: string[]) => Promise<void>;
}
