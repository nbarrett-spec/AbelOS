export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
// Audit calls use: audit(request, action, entity, entityId?, details?)

/**
 * GET /api/ops/video-rooms
 * Returns active and recent video/voice rooms.
 * Uses AgentTask table with taskType='VIDEO_ROOM' for state storage.
 */
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id') || 'unknown'

    // Fetch active and recent rooms from AgentTask table
    const rooms = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        id,
        status,
        priority,
        payload,
        result,
        "createdAt",
        "updatedAt"
      FROM "AgentTask"
      WHERE "taskType" = 'VIDEO_ROOM'
        AND (
          status = 'PENDING'
          OR "createdAt" >= NOW() - INTERVAL '24 hours'
        )
      ORDER BY "createdAt" DESC
      LIMIT 20
      `
    )

    const activeRooms = rooms
      .filter(r => r.status === 'PENDING')
      .map(r => ({
        roomId: r.id,
        name: r.payload?.name || 'Unnamed Room',
        type: r.payload?.type || 'video',
        createdBy: r.payload?.createdBy || 'Unknown',
        participants: r.payload?.participants || [],
        jobId: r.payload?.jobId || null,
        builderId: r.payload?.builderId || null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))

    const recentRooms = rooms
      .filter(r => r.status !== 'PENDING')
      .map(r => ({
        roomId: r.id,
        name: r.payload?.name || 'Unnamed Room',
        type: r.payload?.type || 'video',
        createdBy: r.payload?.createdBy || 'Unknown',
        participants: r.payload?.participants || [],
        jobId: r.payload?.jobId || null,
        builderId: r.payload?.builderId || null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))

    return NextResponse.json({
      activeRooms,
      recentRooms,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching video rooms:', error)
    return NextResponse.json(
      { error: 'Failed to fetch video rooms' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ops/video-rooms
 * Creates a new video/voice room.
 * Body: { name: string, type: 'video' | 'voice', jobId?: string, builderId?: string }
 */
export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id') || 'unknown'
    const body = await request.json()

    const { name, type = 'video', jobId, builderId } = body

    if (!name || !type) {
      return NextResponse.json(
        { error: 'name and type are required' },
        { status: 400 }
      )
    }

    if (!['video', 'voice'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "video" or "voice"' },
        { status: 400 }
      )
    }

    // Generate room ID
    const roomId = `room_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`

    // Create AgentTask record to store room state
    const newRoom = await prisma.$executeRawUnsafe(
      `
      INSERT INTO "AgentTask" (
        id,
        "agentRole",
        "taskType",
        status,
        priority,
        title,
        description,
        payload,
        "createdBy",
        "createdAt",
        "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      `,
      roomId,
      'OPS', // agentRole
      'VIDEO_ROOM',
      'PENDING',
      'NORMAL',
      name,
      `Video/Voice Room: ${type}`,
      JSON.stringify({
        name,
        type,
        createdBy: staffId,
        participants: [],
        jobId: jobId || null,
        builderId: builderId || null,
      })
    )

    return NextResponse.json(
      {
        roomId,
        name,
        type,
        joinUrl: `/ops/video-rooms/${roomId}`,
        createdAt: new Date().toISOString(),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating video room:', error)
    return NextResponse.json(
      { error: 'Failed to create video room' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/ops/video-rooms
 * Ends (completes) a room by its roomId.
 * Body: { roomId: string }
 */
export async function PATCH(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id') || 'unknown'
    const body = await request.json()

    const { roomId } = body

    if (!roomId) {
      return NextResponse.json(
        { error: 'roomId is required' },
        { status: 400 }
      )
    }

    // Verify room exists and belongs to the user
    const room = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, payload, status FROM "AgentTask"
      WHERE id = $1 AND "taskType" = 'VIDEO_ROOM'
      `,
      roomId
    )

    if (!room || room.length === 0) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      )
    }

    // Only the creator can end the room
    if (room[0].payload?.createdBy !== staffId) {
      return NextResponse.json(
        { error: 'Only the room creator can end it' },
        { status: 403 }
      )
    }

    // Mark room as COMPLETE
    await prisma.$executeRawUnsafe(
      `
      UPDATE "AgentTask"
      SET status = 'COMPLETE', "updatedAt" = NOW()
      WHERE id = $1 AND "taskType" = 'VIDEO_ROOM'
      `,
      roomId
    )

    return NextResponse.json({
      roomId,
      status: 'COMPLETE',
      endedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error ending video room:', error)
    return NextResponse.json(
      { error: 'Failed to end video room' },
      { status: 500 }
    )
  }
}
