import { z } from 'zod';

/** Client -> server frames accepted by the signalling relay. */
export const clientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), t: z.number().optional() }),
  z.object({ type: z.literal('heartbeat') }),
  z.object({
    type: z.literal('device:status'),
    telemetry: z.record(z.unknown()).optional(),
    battery: z.number().min(0).max(100).optional(),
    charging: z.boolean().optional(),
    network: z.string().max(32).optional(),
  }),
  z.object({
    type: z.literal('connection:accept'),
    connectionId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('connection:reject'),
    connectionId: z.string().uuid(),
    reason: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('rtc:offer'),
    connectionId: z.string().uuid(),
    sdp: z.string().min(1).max(200_000),
    kind: z.enum(['mirror', 'camera', 'control']).optional(),
  }),
  z.object({
    type: z.literal('rtc:answer'),
    connectionId: z.string().uuid(),
    sdp: z.string().min(1).max(200_000),
  }),
  z.object({
    type: z.literal('rtc:ice'),
    connectionId: z.string().uuid(),
    candidate: z.string().min(1).max(4_000),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
  }),
  z.object({
    type: z.literal('rtc:hangup'),
    connectionId: z.string().uuid(),
    reason: z.string().max(200).optional(),
  }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

export type ServerFrame = { type: string; [key: string]: unknown };

export const SIGNALING_TYPES = new Set([
  'connection:accept',
  'connection:reject',
  'rtc:offer',
  'rtc:answer',
  'rtc:ice',
  'rtc:hangup',
]);
