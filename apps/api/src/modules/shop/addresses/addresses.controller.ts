import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Owns } from '../../../common/decorators/owns.decorator';
import { Address } from '../../../database/schemas/address.schema';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { AddressView, AddressesService } from './addresses.service';
import { CreateAddressDto, UpdateAddressDto } from './dto';

/**
 * Saved delivery addresses.
 *
 * Every single-resource route carries `@Owns`, so `ResourceOwnerGuard`
 * loads the document and compares `customerId` to the `sub` claim of the
 * verified token before the handler runs. A mismatch is a 404, not a 403:
 * a 403 would confirm the id exists and turn this into an enumeration
 * oracle over every customer's address book.
 */
@ApiTags('shop/addresses')
@ApiBearerAuth()
@Controller('addresses')
@Roles(Role.CUSTOMER)
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'The caller\'s addresses, default first' })
  list(@CurrentUser() user: JwtUser): Promise<AddressView[]> {
    return this.addresses.list(user.sub);
  }

  @Post()
  @ApiOperation({
    summary: 'Save an address',
    description:
      'The first address saved is always the default. Setting ' +
      '`isDefault` demotes the previous one, so there is exactly one.',
  })
  create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressView> {
    return this.addresses.create(user.sub, dto);
  }

  @Get(':id')
  @Owns({ model: Address.name, param: 'id', field: 'customerId' })
  @ApiOperation({ summary: 'One address' })
  @ApiNotFoundResponse({
    description: 'Unknown id, malformed id, or somebody else\'s address.',
  })
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<AddressView> {
    return this.addresses.findOne(user.sub, id);
  }

  @Patch(':id')
  @Owns({ model: Address.name, param: 'id', field: 'customerId' })
  @ApiOperation({ summary: 'Update an address' })
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressView> {
    return this.addresses.update(user.sub, id, dto);
  }

  @Delete(':id')
  @Owns({ model: Address.name, param: 'id', field: 'customerId' })
  @ApiOperation({
    summary: 'Delete an address',
    description: 'Deleting the default promotes the next most recent one.',
  })
  remove(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    return this.addresses.remove(user.sub, id);
  }
}
