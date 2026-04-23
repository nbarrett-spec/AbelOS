export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'

interface Task {
  id: string
  label: string
  count: number
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  href: string
  category: string
}

interface MyDayResponse {
  greeting: string
  role: string
  date: string
  tasks: Task[]
  summary: {
    totalTasks: number
    highPriority: number
    mediumPriority: number
    lowPriority: number
  }
}

function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function getFormattedDate(): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }
  return new Date().toLocaleDateString('en-US', options)
}

async function queryCount(sql: string, params: any[] = []): Promise<number> {
  try {
    const result = await prisma.$queryRawUnsafe<{ c: number }[]>(sql, ...params)
    return result?.[0]?.c ?? 0
  } catch (error) {
    console.error(`Query failed: ${sql}`, error)
    return 0
  }
}

async function getAdminManagerTasks(): Promise<Task[]> {
  const tasks: Task[] = []

  // Overdue invoices (7+ days past due)
  const overdueCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Invoice" WHERE "status"::text = 'OVERDUE' AND "dueDate" < NOW() - INTERVAL '7 days'`
  )
  if (overdueCount > 0) {
    tasks.push({
      id: 'task_admin_overdue',
      label: `Review ${overdueCount} overdue invoice${overdueCount !== 1 ? 's' : ''} (7+ days)`,
      count: overdueCount,
      priority: 'HIGH',
      href: '/ops/finance/ar',
      category: 'Finance',
    })
  }

  // Pending quote requests
  const pendingQuotesCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Quote" WHERE "status"::text = 'DRAFT'`
  )
  if (pendingQuotesCount > 0) {
    tasks.push({
      id: 'task_admin_quotes',
      label: `${pendingQuotesCount} quote request${pendingQuotesCount !== 1 ? 's' : ''} awaiting approval`,
      count: pendingQuotesCount,
      priority: 'HIGH',
      href: '/ops/quotes',
      category: 'Sales',
    })
  }

  // Stale deals (no activity 14+ days)
  const staleDealsCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Deal" WHERE "stage"::text NOT IN ('WON','LOST') AND "updatedAt" < NOW() - INTERVAL '14 days'`
  )
  if (staleDealsCount > 0) {
    tasks.push({
      id: 'task_admin_stale',
      label: `${staleDealsCount} deal${staleDealsCount !== 1 ? 's' : ''} inactive 14+ days`,
      count: staleDealsCount,
      priority: 'MEDIUM',
      href: '/ops/sales/deals',
      category: 'Sales',
    })
  }

  // Open high-priority agent tasks
  const highPriorityTasksCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "AgentTask" WHERE "status" = 'PENDING' AND "priority" = 'HIGH'`
  )
  if (highPriorityTasksCount > 0) {
    tasks.push({
      id: 'task_admin_agent',
      label: `${highPriorityTasksCount} high-priority action item${highPriorityTasksCount !== 1 ? 's' : ''}`,
      count: highPriorityTasksCount,
      priority: 'HIGH',
      href: '/ops/agent',
      category: 'Operations',
    })
  }

  // Orders needing review (RECEIVED status — newly placed, not yet confirmed)
  const ordersReviewCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Order" WHERE "status"::text = 'RECEIVED'`
  )
  if (ordersReviewCount > 0) {
    tasks.push({
      id: 'task_admin_orders',
      label: `${ordersReviewCount} order${ordersReviewCount !== 1 ? 's' : ''} pending review`,
      count: ordersReviewCount,
      priority: 'HIGH',
      href: '/ops/orders',
      category: 'Operations',
    })
  }

  // Builder applications pending
  const pendingBuildersCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Builder" WHERE "status"::text = 'PENDING'`
  )
  if (pendingBuildersCount > 0) {
    tasks.push({
      id: 'task_admin_builders',
      label: `${pendingBuildersCount} builder application${pendingBuildersCount !== 1 ? 's' : ''} to approve`,
      count: pendingBuildersCount,
      priority: 'MEDIUM',
      href: '/ops/accounts/applications',
      category: 'Customers',
    })
  }

  return tasks
}

async function getSalesRepTasks(staffId: string): Promise<Task[]> {
  const tasks: Task[] = []

  // My open deals
  const myDealsCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Deal" WHERE "ownerId" = $1 AND "stage"::text NOT IN ('WON','LOST')`,
    [staffId]
  )
  if (myDealsCount > 0) {
    tasks.push({
      id: 'task_sales_deals',
      label: `${myDealsCount} open deal${myDealsCount !== 1 ? 's' : ''} in progress`,
      count: myDealsCount,
      priority: 'HIGH',
      href: '/ops/sales/deals',
      category: 'Sales',
    })
  }

  // Quotes pending response (sent quotes awaiting builder review)
  // Note: Quote model doesn't have salesRepId, so returning all SENT quotes
  const myQuotesCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Quote" WHERE "status"::text = 'SENT'`
  )
  if (myQuotesCount > 0) {
    tasks.push({
      id: 'task_sales_quotes',
      label: `${myQuotesCount} quote${myQuotesCount !== 1 ? 's' : ''} awaiting response`,
      count: myQuotesCount,
      priority: 'MEDIUM',
      href: '/ops/quotes',
      category: 'Sales',
    })
  }

  // Follow-ups due today (deals in negotiation or bid review stage need follow-up)
  // Note: Deal model doesn't have nextFollowUp field, using deals in active stages instead
  const followUpsCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Deal" WHERE "ownerId" = $1 AND "stage"::text IN ('NEGOTIATION','BID_REVIEW') AND "expectedCloseDate" <= CURRENT_DATE`,
    [staffId]
  )
  if (followUpsCount > 0) {
    tasks.push({
      id: 'task_sales_followup',
      label: `${followUpsCount} follow-up call${followUpsCount !== 1 ? 's' : ''} due today`,
      count: followUpsCount,
      priority: 'HIGH',
      href: '/ops/sales/deals',
      category: 'Sales',
    })
  }

  // New leads to work
  const newLeadsCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Deal" WHERE "ownerId" = $1 AND "stage"::text = 'PROSPECT' AND "createdAt" > NOW() - INTERVAL '7 days'`,
    [staffId]
  )
  if (newLeadsCount > 0) {
    tasks.push({
      id: 'task_sales_leads',
      label: `${newLeadsCount} new lead${newLeadsCount !== 1 ? 's' : ''} this week`,
      count: newLeadsCount,
      priority: 'MEDIUM',
      href: '/ops/sales/deals',
      category: 'Sales',
    })
  }

  return tasks
}

async function getProjectManagerTasks(): Promise<Task[]> {
  const tasks: Task[] = []

  // Jobs scheduled today
  const todayJobsCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Job" WHERE "scheduledDate"::date = CURRENT_DATE AND "status"::text NOT IN ('COMPLETED','CANCELLED')`
  )
  if (todayJobsCount > 0) {
    tasks.push({
      id: 'task_pm_jobs',
      label: `${todayJobsCount} job${todayJobsCount !== 1 ? 's' : ''} scheduled for today`,
      count: todayJobsCount,
      priority: 'HIGH',
      href: '/ops/jobs',
      category: 'Operations',
    })
  }

  // Note: WarrantyClaim table does not exist in schema. This task has been removed.
  // Consider using Quality Checks or DecisionNote exceptions for warranty tracking.

  // Orders ready to ship
  const readyToShipCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Order" WHERE "status"::text = 'READY_TO_SHIP'`
  )
  if (readyToShipCount > 0) {
    tasks.push({
      id: 'task_pm_shipping',
      label: `${readyToShipCount} order${readyToShipCount !== 1 ? 's' : ''} ready to ship`,
      count: readyToShipCount,
      priority: 'HIGH',
      href: '/ops/orders',
      category: 'Operations',
    })
  }

  // Material ETAs today
  const materialETAsCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "PurchaseOrder" WHERE "expectedDate"::date = CURRENT_DATE AND "status"::text = 'ORDERED'`
  )
  if (materialETAsCount > 0) {
    tasks.push({
      id: 'task_pm_materials',
      label: `${materialETAsCount} material${materialETAsCount !== 1 ? 's' : ''} arriving today`,
      count: materialETAsCount,
      priority: 'HIGH',
      href: '/ops/purchasing',
      category: 'Purchasing',
    })
  }

  return tasks
}

async function getPurchasingTasks(): Promise<Task[]> {
  const tasks: Task[] = []

  // POs to review
  const draftPOsCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "PurchaseOrder" WHERE "status"::text = 'DRAFT'`
  )
  if (draftPOsCount > 0) {
    tasks.push({
      id: 'task_purch_pos',
      label: `${draftPOsCount} PO${draftPOsCount !== 1 ? 's' : ''} ready to approve`,
      count: draftPOsCount,
      priority: 'HIGH',
      href: '/ops/purchasing',
      category: 'Purchasing',
    })
  }

  // Low stock items
  const lowStockCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "InventoryItem" ii WHERE ii."onHand" <= ii."reorderPoint" AND ii."onHand" > 0`
  )
  if (lowStockCount > 0) {
    tasks.push({
      id: 'task_purch_low',
      label: `${lowStockCount} item${lowStockCount !== 1 ? 's' : ''} below reorder point`,
      count: lowStockCount,
      priority: 'MEDIUM',
      href: '/ops/inventory',
      category: 'Inventory',
    })
  }

  // Out of stock
  const outOfStockCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "InventoryItem" ii WHERE ii."onHand" <= 0`
  )
  if (outOfStockCount > 0) {
    tasks.push({
      id: 'task_purch_oos',
      label: `${outOfStockCount} item${outOfStockCount !== 1 ? 's' : ''} out of stock`,
      count: outOfStockCount,
      priority: 'HIGH',
      href: '/ops/inventory',
      category: 'Inventory',
    })
  }

  // Receiving today
  const receivingTodayCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "PurchaseOrder" WHERE "expectedDate"::date = CURRENT_DATE AND "status"::text = 'ORDERED'`
  )
  if (receivingTodayCount > 0) {
    tasks.push({
      id: 'task_purch_receiving',
      label: `${receivingTodayCount} shipment${receivingTodayCount !== 1 ? 's' : ''} arriving today`,
      count: receivingTodayCount,
      priority: 'MEDIUM',
      href: '/ops/receiving',
      category: 'Purchasing',
    })
  }

  return tasks
}

async function getWarehouseTasks(): Promise<Task[]> {
  const tasks: Task[] = []

  // Pick lists pending
  const pickListsCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Order" WHERE "status"::text = 'PROCESSING'`
  )
  if (pickListsCount > 0) {
    tasks.push({
      id: 'task_warehouse_pick',
      label: `${pickListsCount} pick list${pickListsCount !== 1 ? 's' : ''} to process`,
      count: pickListsCount,
      priority: 'HIGH',
      href: '/ops/warehouse/pick-scanner',
      category: 'Warehouse',
    })
  }

  // Deliveries scheduled today (use Delivery table instead of Order)
  const deliveriesTodayCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Delivery" WHERE "status"::text IN ('SCHEDULED','LOADING','IN_TRANSIT') AND DATE("createdAt") = CURRENT_DATE`
  )
  if (deliveriesTodayCount > 0) {
    tasks.push({
      id: 'task_warehouse_delivery',
      label: `${deliveriesTodayCount} delivery${deliveriesTodayCount !== 1 ? 's' : ''} going out today`,
      count: deliveriesTodayCount,
      priority: 'HIGH',
      href: '/ops/delivery',
      category: 'Warehouse',
    })
  }

  // Receiving expected
  const receivingExpectedCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "PurchaseOrder" WHERE "expectedDate"::date = CURRENT_DATE`
  )
  if (receivingExpectedCount > 0) {
    tasks.push({
      id: 'task_warehouse_receive',
      label: `${receivingExpectedCount} shipment${receivingExpectedCount !== 1 ? 's' : ''} to receive today`,
      count: receivingExpectedCount,
      priority: 'MEDIUM',
      href: '/ops/receiving',
      category: 'Warehouse',
    })
  }

  return tasks
}

async function getAccountingTasks(): Promise<Task[]> {
  const tasks: Task[] = []

  // Invoices to send
  const draftInvoicesCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Invoice" WHERE "status"::text = 'DRAFT'`
  )
  if (draftInvoicesCount > 0) {
    tasks.push({
      id: 'task_acct_draft',
      label: `${draftInvoicesCount} invoice${draftInvoicesCount !== 1 ? 's' : ''} ready to send`,
      count: draftInvoicesCount,
      priority: 'HIGH',
      href: '/ops/finance/ar',
      category: 'Finance',
    })
  }

  // Overdue invoices
  const overdueInvoicesCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Invoice" WHERE "status"::text = 'OVERDUE' AND "dueDate" < NOW()`
  )
  if (overdueInvoicesCount > 0) {
    tasks.push({
      id: 'task_acct_overdue',
      label: `${overdueInvoicesCount} overdue invoice${overdueInvoicesCount !== 1 ? 's' : ''}`,
      count: overdueInvoicesCount,
      priority: 'HIGH',
      href: '/ops/finance/ar',
      category: 'Finance',
    })
  }

  // Partial payments to process
  const partialPaymentsCount = await queryCount(
    `SELECT COUNT(*)::int AS c FROM "Invoice" WHERE "status"::text = 'PARTIAL'`
  )
  if (partialPaymentsCount > 0) {
    tasks.push({
      id: 'task_acct_partial',
      label: `${partialPaymentsCount} partial payment${partialPaymentsCount !== 1 ? 's' : ''} to apply`,
      count: partialPaymentsCount,
      priority: 'MEDIUM',
      href: '/ops/finance/ar',
      category: 'Finance',
    })
  }

  return tasks
}

export async function GET(request: NextRequest) {
  // Auth check
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  // Get staff info from middleware headers
  const staffId = request.headers.get('x-staff-id') || ''
  const staffRole = request.headers.get('x-staff-role') || ''
  const staffName = request.headers.get('x-staff-name') || 'there'

  try {
    let roleTasks: Task[] = []

    // Role-based task generation
    if (staffRole === 'ADMIN' || staffRole === 'MANAGER') {
      roleTasks = await getAdminManagerTasks()
    } else if (staffRole === 'SALES_REP') {
      roleTasks = await getSalesRepTasks(staffId)
    } else if (staffRole === 'PROJECT_MANAGER') {
      roleTasks = await getProjectManagerTasks()
    } else if (staffRole === 'PURCHASING') {
      roleTasks = await getPurchasingTasks()
    } else if (staffRole === 'WAREHOUSE_LEAD' || staffRole === 'WAREHOUSE_TECH') {
      roleTasks = await getWarehouseTasks()
    } else if (staffRole === 'ACCOUNTING') {
      roleTasks = await getAccountingTasks()
    }

    // Add unread notifications for all roles
    const unreadNotificationsCount = await queryCount(
      `SELECT COUNT(*)::int AS c FROM "Notification" WHERE "staffId" = $1 AND "read" = false`,
      [staffId]
    )
    if (unreadNotificationsCount > 0) {
      roleTasks.push({
        id: 'task_notifications',
        label: `${unreadNotificationsCount} unread notification${unreadNotificationsCount !== 1 ? 's' : ''}`,
        count: unreadNotificationsCount,
        priority: 'LOW',
        href: '/ops/notifications',
        category: 'Notifications',
      })
    }

    // Calculate priority summary
    const summary = {
      totalTasks: roleTasks.length,
      highPriority: roleTasks.filter((t) => t.priority === 'HIGH').length,
      mediumPriority: roleTasks.filter((t) => t.priority === 'MEDIUM').length,
      lowPriority: roleTasks.filter((t) => t.priority === 'LOW').length,
    }

    const response: MyDayResponse = {
      greeting: `${getTimeOfDayGreeting()}, ${staffName}`,
      role: staffRole,
      date: getFormattedDate(),
      tasks: roleTasks,
      summary,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error in /api/ops/my-day:', error)
    return NextResponse.json({ error: 'Failed to generate My Day' }, { status: 500 })
  }
}
