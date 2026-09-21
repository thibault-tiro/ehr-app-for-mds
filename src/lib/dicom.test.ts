import {
  CT_WINDOW_PRESETS,
  formatDicomDate,
  formatPersonName,
  fromVoiRange,
  looksLikeDicom,
  seriesLabel,
  toVoiRange,
} from './dicom'
import type { DicomSeries } from './dicom'

describe('patient names', () => {
  // DICOM PS3.5 writes names as Family^Given^Middle^Prefix^Suffix.
  test('reads the standard five-part form', () => {
    expect(formatPersonName('Peeters^Jan^Marie^Dr^MD')).toBe(
      'Dr Jan Marie Peeters MD',
    )
  })

  test('copes with the usual two-part form', () => {
    expect(formatPersonName('Peeters^Jan')).toBe('Jan Peeters')
  })

  test('copes with a family name only', () => {
    expect(formatPersonName('Peeters')).toBe('Peeters')
  })

  test('copes with trailing empty parts, which scanners often write', () => {
    expect(formatPersonName('Peeters^Jan^^^')).toBe('Jan Peeters')
  })

  test('is blank when there is no name', () => {
    expect(formatPersonName(undefined)).toBe('')
    expect(formatPersonName('')).toBe('')
  })
})

describe('dates', () => {
  // DICOM PS3.5 writes dates as YYYYMMDD.
  test('reads the standard form', () => {
    expect(formatDicomDate('20240115')).toBe('15 Jan 2024')
  })

  test('ignores a time that is stuck on the end', () => {
    expect(formatDicomDate('20240115120000')).toBe('15 Jan 2024')
  })

  test('hands back anything it does not recognise', () => {
    expect(formatDicomDate('not a date')).toBe('not a date')
    expect(formatDicomDate('20241315')).toBe('20241315')
  })

  test('is blank when there is no date', () => {
    expect(formatDicomDate(undefined)).toBe('')
  })
})

describe('brightness and contrast', () => {
  test('centre and width become a low and high value', () => {
    // A soft-tissue window of centre 50, width 400 covers -150 to 250 HU.
    expect(toVoiRange(50, 400)).toEqual({ lower: -150, upper: 250 })
  })

  test('and convert back again', () => {
    expect(fromVoiRange({ lower: -150, upper: 250 })).toEqual({
      center: 50,
      width: 400,
    })
  })

  test('every preset survives the round trip', () => {
    for (const preset of CT_WINDOW_PRESETS) {
      expect(fromVoiRange(toVoiRange(preset.center, preset.width))).toEqual({
        center: preset.center,
        width: preset.width,
      })
    }
  })

  test('the standard CT windows are present and correct', () => {
    // Reference values as used in routine CT reporting.
    expect(CT_WINDOW_PRESETS).toEqual(
      expect.arrayContaining([
        { label: 'Lung', center: -600, width: 1500 },
        { label: 'Bone', center: 400, width: 1800 },
        { label: 'Brain', center: 40, width: 80 },
      ]),
    )
  })
})

describe('recognising a DICOM file', () => {
  const withMarker = (marker: string) => {
    const bytes = new Uint8Array(200)
    for (let i = 0; i < marker.length; i++) {
      bytes[128 + i] = marker.charCodeAt(i)
    }
    return bytes
  }

  test('accepts the DICM marker at byte 128', () => {
    expect(looksLikeDicom(withMarker('DICM'))).toBe(true)
  })

  test('rejects a file without it, such as a readme on a CD', () => {
    expect(looksLikeDicom(withMarker('TEXT'))).toBe(false)
  })

  test('rejects a file too short to hold one', () => {
    expect(looksLikeDicom(new Uint8Array(10))).toBe(false)
  })
})

describe('series labels', () => {
  const series = (extra: Partial<DicomSeries>): DicomSeries => ({
    key: 'k',
    modality: 'CT',
    seriesNumber: 2,
    seriesDescription: 'Thorax',
    studyDescription: '',
    studyDate: '',
    patientName: '',
    patientId: '',
    birthDate: '',
    sex: '',
    institution: '',
    rows: 512,
    columns: 512,
    imageIds: [],
    ...extra,
  })

  test('numbers the series and names it', () => {
    expect(seriesLabel(series({}))).toBe('2. Thorax')
  })

  test('falls back to the modality when there is no description', () => {
    expect(seriesLabel(series({ seriesDescription: '' }))).toBe('2. CT')
  })

  test('leaves the number off when the file does not give one', () => {
    expect(seriesLabel(series({ seriesNumber: null }))).toBe('Thorax')
  })
})
