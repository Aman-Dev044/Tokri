import { Controller, Get } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(@InjectConnection() private readonly mongo: Connection) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok', at: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready() {
    const mongoUp = this.mongo.readyState === 1;

    // Confirms the deployment is a REPLICA SET, not a standalone mongod.
    // Transactions do not exist on standalone, and without them the
    // checkout stock reservation cannot be atomic.
    let replicaSet = false;
    try {
      const info = await this.mongo.db?.admin().command({ hello: 1 });
      replicaSet = Boolean(info?.setName);
    } catch {
      replicaSet = false;
    }

    const ok = mongoUp && replicaSet;
    return {
      status: ok ? 'ok' : 'degraded',
      checks: {
        mongo: mongoUp ? 'up' : 'down',
        transactions: replicaSet
          ? 'available'
          : 'UNAVAILABLE — mongod is not running as a replica set',
      },
      at: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
