// init, initProducer, handleResponse

import { type onMessageFunction } from '../types/onMessageFunction';

export interface IStartupService {
  init: (onMessage: onMessageFunction, parConsumerStreamNames?: string[], parProducerStreamName?: string) => Promise<boolean>;
  initProducer: (parProducerStreamName?: string) => Promise<boolean>;
  handleResponse: (response: object, subject?: string[]) => Promise<void>;
}
