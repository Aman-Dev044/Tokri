import { Controller, Get } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(@InjectConnection() private readonly mongo: Connection) {}

  @Public()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Answers as long as the process is up. It touches nothing else on ' +
      'purpose: a liveness probe that checks the database restarts a ' +
      'healthy API every time the database hiccups.',
  })
  @Get('live')
  live() {
    return { status: 'ok', at: new Date().toISOString() };
  }

  @Public()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Whether this instance can actually serve traffic: MongoDB reachable, ' +
      'and the deployment a REPLICA SET rather than a standalone mongod. ' +
      'Transactions do not exist on standalone, and without them the ' +
      'checkout stock reservation cannot be atomic — so a standalone ' +
      'deployment is not ready even though it answers.',
  })
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
