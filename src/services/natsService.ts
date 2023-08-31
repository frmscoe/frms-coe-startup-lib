import { JSONCodec, connect, type NatsConnection, type Subscription } from 'nats';
import { type IStartupService } from '..';
import { type ILoggerService } from '../interfaces';
import { startupConfig } from '../interfaces/iStartupConfig';
import { type onMessageFunction } from '../types/onMessageFunction';

export class NatsService implements IStartupService {
  server = {
    servers: startupConfig.serverUrl,
  };

  producerStreamName = '';
  consumerStreamName = '';
  functionName = '';
  NatsConn?: NatsConnection;
  logger?: ILoggerService | Console;
  jc = JSONCodec();

  /**
   * Initialize Nats consumer, supplying a callback function to call every time a new message comes in.
   *
   * @export
   * @param {Function} onMessage Method to be called every time there's a new message. Will be called with two parameters:
   * A json object with the message as parameter;
   * A handleResponse method that should be called when the function is done processing, giving the response object as parameter.
   *
   * The Following environmental variables is required for this function to work:
   * NODE_ENV=debug
   * SERVER_URL=0.0.0.0:4222 <- Nats Server URL
   * FUNCTION_NAME=function_name <- Function Name is used to determine streams.
   *
   * @return {*}  {Promise<boolean>}
   */

  async init(onMessage: onMessageFunction, loggerService?: ILoggerService): Promise<boolean> {
    try {
      // Validate additional Environmental Variables.
      if (!startupConfig.consumerStreamName) {
        throw new Error(`No Consumer Stream Name Provided in environmental Variable`);
      }

      await this.initProducer(loggerService);
      if (!this.NatsConn || !this.logger) return await Promise.resolve(false);

      // this promise indicates the client closed
      const done = this.NatsConn.closed();

      // Add consumer streams
      this.consumerStreamName = startupConfig.consumerStreamName; // "RuleRequest";
      const consumerStreamNames = this.consumerStreamName.split(',');
      const subs: Subscription[] = [];
      for (const consumerStream of consumerStreamNames) {
        subs.push(this.NatsConn.subscribe(`${consumerStream}`, { queue: `${this.functionName}` }));
      }

      (async () => {
        for (const sub of subs) {
          this.subscribe(sub, onMessage);
        }
      })();
    } catch (err) {
      this.logger?.log(`Error communicating with NATS on: ${JSON.stringify(this.server)}, with error: ${JSON.stringify(err)}`);
      throw err;
    }
    return true;
  }

  async subscribe(subscription: Subscription, onMessage: onMessageFunction): Promise<void> {
    for await (const message of subscription) {
      this.logger?.log(`${Date.now().toLocaleString()} sid:[${message?.sid}] subject:[${message.subject}]: ${message.data.length}`);
      const request = this.jc.decode(message.data);
      await onMessage(request, this.handleResponse);
    }
  }

  /**
   * Initialize Nats Producer
   *
   * @export
   * @param {Function} loggerService
   *
   * Method to init Producer Stream. This function will not react to incomming NATS messages.
   * The Following environmental variables is required for this function to work:
   * NODE_ENV=debug
   * SERVER_URL=0.0.0.0:4222 - Nats Server URL
   * FUNCTION_NAME=function_name - Function Name is used to determine streams.
   * PRODUCER_STREAM - Stream name for the producer Stream
   *
   * @return {*}  {Promise<boolean>}
   */

  async initProducer(loggerService?: ILoggerService): Promise<boolean> {
    await this.validateEnvironment();
    if (loggerService) {
      this.logger = startupConfig.env === 'dev' || startupConfig.env === 'test' ? console : loggerService;
    } else {
      this.logger = console;
    }

    try {
      // Connect to NATS Server
      this.logger.log(`Attempting connection to NATS, with config:\n${JSON.stringify(startupConfig, null, 4)}`);
      this.NatsConn = await connect(this.server);
      this.logger.log(`Connected to ${this.NatsConn.getServer()}`);
      this.functionName = startupConfig.functionName.replace(/\./g, '_');

      // Init producer streams
      this.producerStreamName = startupConfig.producerStreamName;
    } catch (error) {
      this.logger.log(`Error communicating with NATS on: ${JSON.stringify(this.server)}, with error: ${JSON.stringify(error)}`);
      throw error;
    }

    this.NatsConn.closed().then(async () => {
      this.logger!.log('Connection Lost to NATS Server.');
    });

    return true;
  }

  async validateEnvironment(): Promise<void> {
    if (!startupConfig.producerStreamName) {
      throw new Error(`No Producer Stream Name Provided in environmental Variable`);
    }

    if (!startupConfig.serverUrl) {
      throw new Error(`No Server URL was Provided in environmental Variable`);
    }

    if (!startupConfig.functionName) {
      throw new Error(`No Function Name was Provided in environmental Variable`);
    }
  }

  /**
   * Handle the response once the function executed by onMessage is complete. Publish it to the Producer Stream
   *
   * @export
   * @param {string} response Response string to be send to the producer stream.
   *
   * @return {*}  {Promise<void>}
   */
  async handleResponse(response: unknown, subject?: string[]): Promise<void> {
    if (this.producerStreamName && this.NatsConn) {
      if (!subject) {
        this.NatsConn.publish(this.producerStreamName, this.jc.encode(response));
      } else {
        for (const sub of subject) {
          this.NatsConn.publish(sub, this.jc.encode(response));
        }
      }
    }
  }
}
