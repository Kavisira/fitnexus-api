import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface JwtPayload {
  sub: string;
  email: string;
  organizationId: string;
}

/** One Socket.IO room per organization ("org:<id>") — every logged-in
 * user in an organization gets every notification for that org
 * (notifications are org-wide for now, see NotificationsService).
 * Auth mirrors JwtAuthGuard but done by hand, since HTTP guards don't
 * run against a socket handshake. */
@Injectable()
@WebSocketGateway({ namespace: '/notifications', cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private jwtService: JwtService) {}

  handleConnection(client: Socket): void {
    const token = (client.handshake.auth?.['token'] as string) || (client.handshake.query?.['token'] as string);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      client.join(`org:${payload.organizationId}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // Nothing to clean up — Socket.IO drops room membership automatically.
  }

  /** Called by NotificationsService right after a notification is
   * created, so every connected client in the organization sees it the
   * instant it happens rather than waiting for their next poll. */
  emitToOrganization(organizationId: string, notification: unknown): void {
    this.server.to(`org:${organizationId}`).emit('notification', notification);
  }
}
