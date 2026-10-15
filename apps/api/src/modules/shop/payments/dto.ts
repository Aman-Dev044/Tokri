import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * `POST /payments/:orderId/verify`
 *
 * The three fields Razorpay's checkout sheet hands the browser on
 * success (`razorpay_order_id`, `razorpay_payment_id`,
 * `razorpay_signature`), named after what they are rather than the
 * vendor's field names — this DTO is never re-serialised to Razorpay, so
 * the wire names are ours to choose.
 *
 * Per §8.3 this endpoint is an OPTIMISATION, never the source of truth:
 * it lets a customer who is still looking at the screen see their order
 * confirm immediately, but if the webhook already landed first, this
 * call is a harmless no-op that reports the same result.
 */
export class VerifyPaymentDto {
  @ApiProperty({ description: 'The Razorpay gateway order id.' })
  @IsString()
  @Length(1, 100)
  providerOrderId: string;

  @ApiProperty({ description: 'The Razorpay payment id for this attempt.' })
  @IsString()
  @Length(1, 100)
  providerPaymentId: string;

  @ApiProperty({ description: 'HMAC-SHA256 signature from the checkout sheet.' })
  @IsString()
  @Length(1, 512)
  signature: string;
}
