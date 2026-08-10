import { Types } from 'mongoose'
import { randomUUID } from 'crypto'
import PDFDocument from 'pdfkit'
import { EnrollmentModel, CourseModel, UserModel } from '@/models/schema.ts'

export class CertificateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'CertificateError'
  }
}

export class CertificateService {

  /** Issue (or re-issue) a certificate for a completed enrollment.
   *  Stores the UUID in enrollment.certificateId and returns a PDF buffer. */
  async generate(enrollmentId: string, requesterId: string): Promise<{
    buffer:    Buffer
    filename:  string
    certId:    string
    studentName: string
    courseTitle: string
    completedAt: Date
  }> {
    /* Validate before querying. `findById` on a value that is not an ObjectId
       throws a Mongoose CastError, which is not a CertificateError, so it fell
       past the error middleware and surfaced as a 500 — any mistyped URL
       produced an "unexpected error" and a stack trace in the logs. Answering
       404 rather than 400 also keeps a malformed id indistinguishable from one
       that simply is not there. */
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new CertificateError('NOT_FOUND', 'Enrollment not found', 404)
    }

    const enrollment = await EnrollmentModel.findById(enrollmentId).exec()
    if (!enrollment) {
      throw new CertificateError('NOT_FOUND', 'Enrollment not found', 404)
    }

    /* Only the student themselves may download their cert */
    if (enrollment.userId.toString() !== requesterId) {
      throw new CertificateError('FORBIDDEN', 'You can only download your own certificate', 403)
    }

    if (enrollment.status !== 'completed') {
      throw new CertificateError('NOT_COMPLETED', 'Course must be completed to generate a certificate', 400)
    }

    /* Look up student + course */
    const [student, course] = await Promise.all([
      UserModel.findById(enrollment.userId).select('name').exec(),
      CourseModel.findById(enrollment.courseId).select('title').exec(),
    ])

    if (!student || !course) {
      throw new CertificateError('DATA_ERROR', 'Student or course data missing', 500)
    }

    /* Assign a cert ID if none yet */
    let certId = enrollment.certificateId
    if (!certId) {
      certId = randomUUID()
      await EnrollmentModel.updateOne({ _id: enrollmentId }, { $set: { certificateId: certId } }).exec()
    }

    const completedAt = enrollment.completedAt ?? new Date()
    const buffer = await this.buildPDF({
      studentName: student.name,
      courseTitle: course.title,
      completedAt,
      certId,
    })

    return {
      buffer,
      filename:    `certificate-${certId}.pdf`,
      certId,
      studentName: student.name,
      courseTitle: course.title,
      completedAt,
    }
  }

  /** Verify a certificate by its UUID (public endpoint) */
  async verify(certId: string): Promise<{
    valid:       boolean
    studentName?: string
    courseTitle?: string
    completedAt?: Date
  }> {
    const enrollment = await EnrollmentModel.findOne({ certificateId: certId }).exec()
    if (!enrollment) return { valid: false }

    const [student, course] = await Promise.all([
      UserModel.findById(enrollment.userId).select('name').exec(),
      CourseModel.findById(enrollment.courseId).select('title').exec(),
    ])

    return {
      valid:       true,
      studentName: student?.name,
      courseTitle: course?.title,
      completedAt: enrollment.completedAt,
    }
  }

  /* ── PDF generation ───────────────────────────────── */
  private buildPDF(data: {
    studentName: string
    courseTitle: string
    completedAt: Date
    certId:      string
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size:    [842, 595],   // A4 landscape
        margin:  0,
        info:    { Title: 'Course Completion Certificate', Author: 'LearnOS' },
      })

      const chunks: Buffer[] = []
      doc.on('data',  chunk => chunks.push(chunk))
      doc.on('end',   () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const W = 842, H = 595

      /* ── Background ────────────────────────────────── */
      doc.rect(0, 0, W, H).fill('#0D0F1A')

      /* Orange gradient accent bar on left */
      const grad = doc.linearGradient(0, 0, 0, H)
      grad.stop(0, '#FF6B1A').stop(1, '#FF8C42')
      doc.rect(0, 0, 8, H).fill(grad)

      /* Subtle top/bottom lines */
      doc.rect(30, 30, W - 60, 1).fill('rgba(255,255,255,0.06)')
      doc.rect(30, H - 31, W - 60, 1).fill('rgba(255,255,255,0.06)')

      /* ── Content ────────────────────────────────────── */
      const cx = W / 2

      /* Badge circle */
      doc.circle(cx, 110, 38)
         .lineWidth(2)
         .strokeColor('#FF6B1A')
         .stroke()

      doc.fontSize(32).fillColor('#FF6B1A').text('🎓', cx - 18, 92)

      /* "Certificate of Completion" label */
      doc.fontSize(11)
         .fillColor('rgba(255,255,255,0.45)')
         .font('Helvetica')
         .text('CERTIFICATE OF COMPLETION', 0, 164, { align: 'center', width: W, characterSpacing: 3 })

      /* Student name */
      doc.fontSize(36)
         .fillColor('#FFFFFF')
         .font('Helvetica-Bold')
         .text(data.studentName, 60, 195, { align: 'center', width: W - 120 })

      /* "has successfully completed" */
      doc.fontSize(12)
         .fillColor('rgba(255,255,255,0.55)')
         .font('Helvetica')
         .text('has successfully completed', 0, 248, { align: 'center', width: W })

      /* Course title */
      doc.fontSize(22)
         .fillColor('#FF6B1A')
         .font('Helvetica-Bold')
         .text(data.courseTitle, 80, 272, { align: 'center', width: W - 160, lineGap: 4 })

      /* Separator */
      const lineY = 340
      doc.moveTo(cx - 80, lineY).lineTo(cx + 80, lineY)
         .lineWidth(0.5).strokeColor('rgba(255,255,255,0.15)').stroke()

      /* Date + cert ID */
      const dateStr = data.completedAt.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })

      doc.fontSize(10)
         .fillColor('rgba(255,255,255,0.45)')
         .font('Helvetica')
         .text(`Completed: ${dateStr}`, 0, lineY + 12, { align: 'center', width: W })

      doc.fontSize(8)
         .fillColor('rgba(255,255,255,0.25)')
         .text(`Certificate ID: ${data.certId}`, 0, H - 55, { align: 'center', width: W })

      /* LearnOS wordmark */
      doc.fontSize(13)
         .fillColor('#FF6B1A')
         .font('Helvetica-Bold')
         .text('LearnOS', 0, H - 40, { align: 'center', width: W })

      doc.end()
    })
  }
}
