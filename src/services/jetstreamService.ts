import {
  AckPolicy,
  JSONCodec,
  RetentionPolicy,
  StorageType,
  connect,
  type ConsumerConfig,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  type StreamConfig,
} from 'nats';
import { type ILoggerService } from '../interfaces';
import { startupConfig } from '../interfaces/iStartupConfig';
import { type IStartupService } from '../interfaces/iStartupService';
import { type onMessageFunction } from '../types/onMessageFunction';

export class JetstreamService implements IStartupService {
  server = {
    servers: startupConfig.serverUrl,
  };

  producerStreamName = '';
  consumerStreamName = '';
  functionName = '';
  NatsConn?: NatsConnection;
  jsm?: JetStreamManager;
  js?: JetStreamClient;
  logger?: ILoggerService | Console;
  onMessage?: onMessageFunction;
  jc = JSONCodec();

  /**
   * Initialize JetStream consumer, supplying a callback function to call every time a new message comes in.
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

      this.onMessage = onMessage;
      await this.initProducer(loggerService);
      // Guard statement to ensure initProducer was successful
      if (!this.NatsConn || !this.jsm || !this.js || !this.logger) return await Promise.resolve(false);

      // Add consumer streams
      this.consumerStreamName = startupConfig.consumerStreamName; // "RuleRequest";
      await this.createConsumer(this.functionName, this.jsm, this.consumerStreamName);

      if (this.consumerStreamName) await this.consume(this.js, onMessage, this.consumerStreamName, this.functionName);
    } catch (err) {
      this.logger?.log(`Error communicating with NATS on: ${JSON.stringify(this.server)}, with error: ${JSON.stringify(err)}`);
      throw err;
    }
    return await Promise.resolve(true);
  }

  /**
   * Initialize JetStream Producer Stream
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

      // Jetstream setup
      this.jsm = await this.NatsConn.jetstreamManager();
      this.js = this.NatsConn.jetstream();

      // Add producer streams
      this.producerStreamName = startupConfig.producerStreamName; // `RuleResponse${functionName}`;
      await this.createStream(this.jsm, this.producerStreamName);
    } catch (error) {
      this.logger.log(`Error communicating with NATS on: ${JSON.stringify(this.server)}, with error: ${JSON.stringify(error)}`);
      throw error;
    }

    this.NatsConn.closed().then(async () => {
      this.logger!.log('Connection Lost to NATS Server, Reconnecting...');
      let connected = false;

      while (!connected) {
        this.logger!.log(`Attempting to recconect to NATS...`);
        connected = await this.connectNats();
        if (!connected) {
          this.logger!.warn(`Unable to connect, retrying....`);
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } else {
          this.logger!.log(`Reconnected to nats`);
          break;
        }
      }
    });

    return await Promise.resolve(true);
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
    await Promise.resolve(undefined);
  }

  async connectNats(): Promise<boolean> {
    try {
      this.NatsConn = await connect(this.server);

      this.jsm = await this.NatsConn.jetstreamManager();
      this.js = this.NatsConn.jetstream();

      if (this.consumerStreamName && this.onMessage) {
        await this.createConsumer(this.functionName, this.jsm, this.consumerStreamName);
        await this.consume(this.js, this.onMessage, this.consumerStreamName, this.functionName);
      }
    } catch (error) {
      this.logger?.log(`Failed to connect to NATS.\n${JSON.stringify(error, null, 4)}`);
      return false;
    }
    return true;
  }

  async createConsumer(functionName: string, jsm: JetStreamManager, consumerStreamName: string): Promise<void> {
    const consumerStreams = consumerStreamName.split(',');

    for (const stream of consumerStreams) {
      await this.createStream(jsm, stream, startupConfig.streamSubject ? startupConfig.streamSubject : undefined);
      // Require Nats Version 2.10 to be released. Slated for a few months.
      // const streamSubjects = startupConfig.streamSubject ? startupConfig.streamSubject.split(',') : [startupConfig.consumerStreamName];

      const typedAckPolicy = startupConfig.ackPolicy;
      const consumerCfg: Partial<ConsumerConfig> = {
        ack_policy: AckPolicy[typedAckPolicy],
        durable_name: functionName,
        // filter_subjects: streamSubjects, Require Nats Version 2.10 to be released. Slated for a few months.
      };
      await jsm.consumers.add(stream, consumerCfg);
      this.logger?.log('Connected Consumer to Consumer Stream');
    }
    await Promise.resolve(undefined);
  }

  async createStream(jsm: JetStreamManager, streamName: string, subjectName?: string): Promise<void> {
    await jsm.streams.find(streamName).then(
      async (stream) => {
        this.logger?.log(`Stream: ${streamName} already exists.`);

        if (subjectName) {
          const subjectList = subjectName.split(',');
          this.logger?.log(`Adding subject(s): ${subjectName} to stream: ${streamName}`);
          const streamInfo = await jsm.streams.info(stream);

          for (const subject of subjectList) {
            if (streamInfo.config.subjects.includes(subject)) {
              this.logger?.log(`Subject: ${subject} Already present`);
              continue;
            }

            if (streamInfo.config.subjects) streamInfo.config.subjects.push(subject);
            else streamInfo.config.subjects = [subject];
            this.logger?.log(`Subject: ${subject} Added.`);
          }
          await jsm.streams.update(streamName, streamInfo.config);
        }
      },
      async (reason) => {
        const typedRetentionPolicy = startupConfig.producerRetentionPolicy as keyof typeof RetentionPolicy;
        const typedStorgage = startupConfig.producerStorage as keyof typeof StorageType;

        const cfg: Partial<StreamConfig> = {
          name: streamName,
          subjects: subjectName ? subjectName.split(',') : [streamName],
          retention: RetentionPolicy[typedRetentionPolicy],
          storage: StorageType[typedStorgage],
        };
        await jsm.streams.add(cfg);
        this.logger?.log(`Created stream: ${streamName}`);
      },
    );
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
    const publishes = [];

    if (this.producerStreamName) {
      if (!subject) {
        publishes.push(this.js?.publish(this.producerStreamName, this.jc.encode(response)));
      } else {
        for (const sub of subject) {
          publishes.push(this.js?.publish(sub, this.jc.encode(response)));
        }
      }
      await Promise.all(publishes);
    }
    await Promise.resolve();
  }

  async consume(js: JetStreamClient, onMessage: onMessageFunction, consumerStreamName: string, functionName: string): Promise<void> {
    // Get the consumer to listen to messages for
    const consumer = await js.consumers.get(consumerStreamName, functionName);

    // create a simple consumer and iterate over messages matching the subscription
    const sub = await consumer.consume({ max_messages: 1 });

    for await (const message of sub) {
      console.debug(`${Date.now().toLocaleString()} S:[${message?.seq}] Q:[${message.subject}]: ${message.data.length}`);
      const request = this.jc.decode(message.data);
      try {
        await onMessage(request, this.handleResponse);
      } catch (error) {
        this.logger?.error(`Error while handling message: \r\n${error as string}`);
      }
      message.ack();
    }
  }
}
