import { Inject, Injectable, Logger } from '@nestjs/common';
import { envs, NATS_SERVICE } from 'src/config';
import { PaymentSessionDto } from './dto/payment-session.dto';
import Stripe from 'stripe';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PaymentsService {

    private readonly stripe = new Stripe(envs.stripeSecret);
    private readonly logger = new Logger('PaymentService');

    constructor(
        @Inject(NATS_SERVICE) private readonly client: ClientProxy
    ){}

    async createPaymentSession(paymenstSessionDto: PaymentSessionDto) {

        const { currency, items, orderId } = paymenstSessionDto;

        const lineItems = items.map(item => {
            return {
                price_data: {
                    currency: currency,
                    product_data: {
                        name: item.name
                    },
                    unit_amount: Math.round(item.price * 100),
                },
                quantity: item.quantity
            }
        });

        const session = await this.stripe.checkout.sessions.create({
            payment_intent_data: {
                metadata: {
                    orderId: orderId
                }
            },

            line_items: lineItems,
            mode: 'payment',
            success_url: envs.stripSuccessUrl,
            cancel_url: envs.stripCancelUrl
        });

        // return session
        return{
            cancelUrl: session.cancel_url,
            successUrl: session.success_url,
            url: session.url,
        }
    }

    async stripeWebhook(req: Request, res: Response) {
        const sig = req.headers['stripe-signature'];

        let event: Stripe.Event;

        const endpointSecret = envs.stripEndPointSecret

        try {
            event = this.stripe.webhooks.constructEvent(
                req['rawBody'],
                sig,
                endpointSecret
            );
        } catch (error) {
            res.status(400).send(`Webhook Error: ${error.message}`);
            return;
        }

        switch (event.type) {
            case 'charge.succeeded':
                const chargeSucceeded = event.data.object;
                const payload = {
                    stripePaymentId: chargeSucceeded.id,
                    orderId: chargeSucceeded.metadata.orderId,
                    receiptUrl: chargeSucceeded.receipt_url,
                }

                // this.logger.log({ payload})
                this.client.emit('payment.succeeded', payload);
                break;

            default:
                console.log(`Event ${event.type} not handled`);
        }

        return res.status(200).json({ sig });
    }

}
