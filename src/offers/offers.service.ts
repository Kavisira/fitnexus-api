import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';

/** Strips whichever type-specific field(s) don't apply to the given
 * offer type, so a stray value sent for the wrong type never persists —
 * e.g. a PERCENT_DISCOUNT offer never ends up with a stale flatAmount
 * from a prior edit that changed its type. */
function typeFields(type: string, dto: { percentValue?: number; flatAmount?: number; extraMonths?: number }) {
  return {
    percentValue: type === 'PERCENT_DISCOUNT' || type === 'COUPLE' ? dto.percentValue ?? null : null,
    flatAmount: type === 'FLAT_DISCOUNT' ? dto.flatAmount ?? null : null,
    extraMonths: type === 'EXTRA_DURATION' ? dto.extraMonths ?? null : null,
  };
}

/**
 * Independent, org-wide offer catalog (see the doc comment on the Offer
 * model) — no plan/branch scoping, unlike every other module here.
 * Applying one of these to an actual member signup happens in the
 * Members module (not built yet), which will read this same list.
 */
@Injectable()
export class OffersService {
  constructor(private prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateOfferDto) {
    return this.prisma.offer.create({
      data: {
        organizationId,
        name: dto.name,
        type: dto.type,
        isActive: dto.isActive ?? true,
        ...typeFields(dto.type, dto),
      },
    });
  }

  findAll(organizationId: string) {
    return this.prisma.offer.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async findOne(organizationId: string, id: string) {
    const offer = await this.prisma.offer.findFirst({ where: { id, organizationId } });
    if (!offer) {
      throw new NotFoundException('Offer not found.');
    }
    return offer;
  }

  async update(organizationId: string, id: string, dto: UpdateOfferDto) {
    const offer = await this.findOne(organizationId, id);
    const type = dto.type ?? offer.type;

    return this.prisma.offer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        // Only re-derive the type-specific fields when the type or one
        // of the value fields actually changed, so a plain isActive
        // toggle (the common case) doesn't accidentally wipe them.
        ...(dto.type !== undefined || dto.percentValue !== undefined || dto.flatAmount !== undefined || dto.extraMonths !== undefined
          ? typeFields(type, {
              percentValue: dto.percentValue ?? (Number(offer.percentValue ?? 0) || undefined),
              flatAmount: dto.flatAmount ?? (Number(offer.flatAmount ?? 0) || undefined),
              extraMonths: dto.extraMonths ?? offer.extraMonths ?? undefined,
            })
          : {}),
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.prisma.offer.delete({ where: { id } });
  }
}
