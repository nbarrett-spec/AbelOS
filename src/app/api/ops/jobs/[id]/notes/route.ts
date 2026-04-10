export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Verify job exists
    const jobExists = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "Job" WHERE "id" = $1',
      params.id
    );

    if (jobExists.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Get decision notes with author data
    const notes = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT dn.*, s."firstName", s."lastName", s."email" as "author_email"
       FROM "DecisionNote" dn
       LEFT JOIN "Staff" s ON s."id" = dn."authorId"
       WHERE dn."jobId" = $1
       ORDER BY dn."createdAt" DESC`,
      params.id
    );

    // Transform to nested author object structure
    const transformedNotes = notes.map(note => {
      const { firstName, lastName, author_email, ...noteData } = note;
      return {
        ...noteData,
        author: firstName || lastName || author_email
          ? { firstName, lastName, email: author_email }
          : null
      };
    });

    return NextResponse.json(transformedNotes, { status: 200 });
  } catch (error) {
    console.error('Error fetching decision notes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch decision notes' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json();
    const { noteType, subject, body: noteBody, priority, authorId } = body;

    // Verify job exists
    const jobExists = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "Job" WHERE "id" = $1',
      params.id
    );

    if (jobExists.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Validate required fields
    if (!noteType || !subject || !noteBody || !authorId) {
      return NextResponse.json(
        {
          error: 'noteType, subject, body, and authorId are required',
        },
        { status: 400 }
      );
    }

    // Generate ID
    const noteId = `dn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();

    // Insert decision note
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DecisionNote" ("id", "jobId", "authorId", "noteType", "subject", "body", "priority", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      noteId,
      params.id,
      authorId,
      noteType,
      subject,
      noteBody,
      priority || 'MEDIUM',
      now,
      now
    );

    // Fetch the created note with author data
    const createdNote = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT dn.*, s."firstName", s."lastName", s."email" as "author_email"
       FROM "DecisionNote" dn
       LEFT JOIN "Staff" s ON s."id" = dn."authorId"
       WHERE dn."id" = $1`,
      noteId
    );

    if (createdNote.length === 0) {
      return NextResponse.json(
        { error: 'Failed to retrieve created note' },
        { status: 500 }
      );
    }

    // Transform to nested author object structure
    const note = createdNote[0];
    const { firstName, lastName, author_email, ...noteData } = note;
    const response = {
      ...noteData,
      author: firstName || lastName || author_email
        ? { firstName, lastName, email: author_email }
        : null
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating decision note:', error);
    return NextResponse.json(
      { error: 'Failed to create decision note' },
      { status: 500 }
    );
  }
}
