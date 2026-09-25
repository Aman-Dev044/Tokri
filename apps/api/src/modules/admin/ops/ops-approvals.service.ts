import { BadRequestException, Injectable } from '@nestjs/common';

import { VendorStatus } from '../../../database/schemas/vendor.schema';
import { PartnerStatus } from '../../../database/schemas/delivery-partner.schema';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { AdminVendorsService, VendorRow } from '../vendors/vendors.service';
import {
  AdminDeliveryPartnersService,
  PartnerRow,
} from '../delivery-partners/delivery-partners.service';
import { ApprovalDecisionDto } from './dto';

export interface ApprovalsInbox {
  vendors: VendorRow[];
  riders: PartnerRow[];
  counts: { vendors: number; riders: number };
}

/** How many pending rows the inbox will return in one go. */
const INBOX_LIMIT = 100;

/**
 * The approvals inbox.
 *
 * ── Why this service owns no status logic ───────────────────────────────
 * Approving a vendor closes their store on anything but `approved`;
 * approving a rider moves their User account in step and clears the
 * refresh-token family. Both rules already live in the services that own
 * those documents, and both exist because of a specific security hole.
 * Re-implementing either here to save an import is how the two copies
 * drift and one of them stops closing the hole.
 *
 * So this is a router with one opinion of its own: a rejection must carry
 * a reason.
 */
@Injectable()
export class AdminOpsApprovalsService {
  constructor(
    private readonly vendors: AdminVendorsService,
    private readonly partners: AdminDeliveryPartnersService,
  ) {}

  async inbox(): Promise<ApprovalsInbox> {
    const [vendors, riders] = await Promise.all([
      this.vendors.list({
        status: VendorStatus.PENDING,
        page: 1,
        limit: INBOX_LIMIT,
      }),
      this.partners.list({
        status: PartnerStatus.PENDING,
        page: 1,
        limit: INBOX_LIMIT,
      }),
    ]);

    return {
      vendors: vendors.data,
      riders: riders.data,
      // The TOTAL, not the page length — the badge must not say 100 when
      // there are 140 stores waiting.
      counts: { vendors: vendors.meta.total, riders: riders.meta.total },
    };
  }

  /**
   * Approve or reject a vendor application.
   *
   * A rejection is recorded as `suspended` with the reason attached,
   * which is the closed-vendor state the rest of the platform already
   * understands. There is deliberately no separate `rejected` state: a
   * rejected application that later passes verification is the same
   * document being re-approved, and a terminal status would force a
   * duplicate store record with a second slug.
   */
  async decideVendor(
    id: string,
    dto: ApprovalDecisionDto,
    actor: JwtUser,
  ): Promise<VendorRow> {
    const reason = this.reasonFor(dto, 'vendor');

    return this.vendors.updateStatus(
      id,
      {
        status:
          dto.decision === 'approve'
            ? VendorStatus.APPROVED
            : VendorStatus.SUSPENDED,
        reason,
      },
      actor,
    );
  }

  async decideRider(
    id: string,
    dto: ApprovalDecisionDto,
    actor: JwtUser,
  ): Promise<PartnerRow> {
    const reason = this.reasonFor(dto, 'delivery partner');

    return this.partners.updateStatus(
      id,
      {
        status:
          dto.decision === 'approve'
            ? PartnerStatus.ACTIVE
            : PartnerStatus.SUSPENDED,
        reason,
      },
      actor,
    );
  }

  /**
   * A rejection without a reason is not reviewable and not appealable —
   * the applicant is told no by a system that cannot say why, and the
   * next admin to look at the record cannot tell whether it was a policy
   * call or a misclick.
   */
  private reasonFor(
    dto: ApprovalDecisionDto,
    subject: string,
  ): string | undefined {
    if (dto.decision !== 'reject') return dto.reason;
    if (!dto.reason?.trim()) {
      throw new BadRequestException(
        `A reason is required when rejecting a ${subject}`,
      );
    }
    return dto.reason;
  }
}
