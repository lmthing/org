import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyKind,
  isSafeUploadId,
  uploadUrl,
  resolveUploadsDir,
  saveUpload,
  readUploadMeta,
  readUploadBytes,
  extractDocumentText,
  extractOfficeText,
  extractPdfPageImages,
  resolveUploadDocument,
} from './uploads.js';

/** A tiny reportlab-generated PDF whose only text is "MASCOT_IS_PICO". */
const TINY_PDF_B64 =
  'JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgaHR0cDovL3d3dy5yZXBvcnRsYWIuY29tCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA1OTUuMjc1NiA4NDEuODg5OCBdIC9QYXJlbnQgNiAwIFIgL1Jlc291cmNlcyA8PAovRm9udCAxIDAgUiAvUHJvY1NldCBbIC9QREYgL1RleHQgL0ltYWdlQiAvSW1hZ2VDIC9JbWFnZUkgXQo+PiAvUm90YXRlIDAgL1RyYW5zIDw8Cgo+PiAKICAvVHlwZSAvUGFnZQo+PgplbmRvYmoKNCAwIG9iago8PAovUGFnZU1vZGUgL1VzZU5vbmUgL1BhZ2VzIDYgMCBSIC9UeXBlIC9DYXRhbG9nCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9BdXRob3IgKGFub255bW91cykgL0NyZWF0aW9uRGF0ZSAoRDoyMDI2MDcwOTA5MzMxNCswMCcwMCcpIC9DcmVhdG9yIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSB3d3cucmVwb3J0bGFiLmNvbSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwNzA5MDkzMzE0KzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSB3d3cucmVwb3J0bGFiLmNvbSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxMDYKPj4Kc3RyZWFtCkdhcFFoMEU9RiwwVVxIM1RccE5ZVF5RS2s/dGM+SVAsO1cjVTFeMjNpaFBFTV8/Q1c0S0lTaTkwTWpHLmlmSUNLJTpALmBCRSsnPGNmIlF1Ok01L09Lb2RqPiYxcnVpIllLZEkzPjVafj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA3MyAwMDAwMCBuIAowMDAwMDAwMTA0IDAwMDAwIG4gCjAwMDAwMDAyMTEgMDAwMDAgbiAKMDAwMDAwMDQxNCAwMDAwMCBuIAowMDAwMDAwNDgyIDAwMDAwIG4gCjAwMDAwMDA3NzggMDAwMDAgbiAKMDAwMDAwMDgzNyAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzxjOTI2ZTQwZTdiZTAwNmUwNzYxYjY0MTY1NzY2ZWQyMT48YzkyNmU0MGU3YmUwMDZlMDc2MWI2NDE2NTc2NmVkMjE+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAoaHR0cDovL3d3dy5yZXBvcnRsYWIuY29tKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKMTAzMwolJUVPRgo=';

/** A minimal valid .docx (OOXML zip) whose body is two paragraphs:
 *  "Quarterly report: revenue grew by 20 percent." / "The team shipped three features." */
const TINY_DOCX_B64 =
  'UEsDBBQAAAAIAKdx6VzIZt/Q7AAAAK8BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyW7CMBC98xWWryhx6KGqqiQcuhzbHugHjOxJYuFNHkPh7zsByqGiPc68Va9dH7wTe8xkY+jkqm6kwKCjsWHs5OfmtXqQggoEAy4G7OQRSa77Rbs5JiTB4kCdnEpJj0qRntAD1TFhYGSI2UPhM48qgd7CiOquae6VjqFgKFWZPWTfPuMAO1fEy4Hf5yIZHUnxdCbOWZ2ElJzVUBhX+2B+pVSXhJqVJw5NNtGSCVLdTJiRvwMuundeJluD4gNyeQPPLPUVs1Em6p1nZf2/zY2ecRisxqt+dks5aiTiyb2rr4gHG376q9Pc/eIbUEsDBAoAAAAAAKdx6VwAAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBBQAAAAIAKdx6Vw6SRuAsQAAACsBAAALAAAAX3JlbHMvLnJlbHONzzsOwjAMBuC9p4i807QMCKGmXRBSV1QOECVuGtE8lIRHb08GBooYGG3//iw33dPM5I4hamcZ1GUFBK1wUlvF4DKcNnsgMXEr+ewsMlgwQtcWzRlnnvJOnLSPJCM2MphS8gdKo5jQ8Fg6jzZPRhcMT7kMinourlwh3VbVjoZPA9qVSXrJIPSyBjIsHv+x3ThqgUcnbgZt+nHiK5FlHhQmBg8XJJXvdplZoG1DVy+2xQtQSwMECgAAAAAAp3HpXAAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQUAAAACACncelcaD/wy9IAAAA5AQAAEQAAAHdvcmQvZG9jdW1lbnQueG1sbY/LasQwDEX38xXC+8bpLEoJSWbXfWH6AR77ThKIH8jKpPn72oVSKN0cIYSOrvrLp1/pAc5LDIN6blpFCDa6JUyD+ri+Pb0qymKCM2sMGNSBrC7jqd87F+3mEYSKIeRuH9Qskjqts53hTW5iQiize2RvpLQ86T2ySxwtci4H/KrPbfuivVmCGovyFt1Ra6rgChnfN8MCXg9ipMjSlfpA2EATY6fbQeeWEtiWKE2v60olfzP9tV1nkMB4yvOSEhzJzADdYWRj5P8E+ieX/v15PH0BUEsBAh4DFAAAAAgAp3HpXMhm39DsAAAArwEAABMAAAAAAAAAAQAAALSBAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECHgMKAAAAAACncelcAAAAAAAAAAAAAAAABgAAAAAAAAAAABAA/UEdAQAAX3JlbHMvUEsBAh4DFAAAAAgAp3HpXDpJG4CxAAAAKwEAAAsAAAAAAAAAAQAAALSBQQEAAF9yZWxzLy5yZWxzUEsBAh4DCgAAAAAAp3HpXAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAQAP1BGwIAAHdvcmQvUEsBAh4DFAAAAAgAp3HpXGg/8MvSAAAAOQEAABEAAAAAAAAAAQAAALSBPgIAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAAFAAUAIAEAAD8DAAAAAA==';

/** A real image-only ("scanned") PDF: one page, one embedded 320x320 image, NO text layer.
 *  This is what a photographed receipt/permit actually is — and it used to be a dead end. */
const SCANNED_PDF_B64 =
  'JVBERi0xLjQKJSBjcmVhdGVkIGJ5IFBpbGxvdyAxMC4yLjAgUERGIGRyaXZlcgo0IDAgb2JqPDwKL1R5cGUgL0NhdGFsb2cKL1Bh' +
  'Z2VzIDUgMCBSCj4+ZW5kb2JqCjUgMCBvYmo8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyAyIDAgUiBdCj4+ZW5kb2Jq' +
  'CjEgMCBvYmo8PAovVHlwZSAvWE9iamVjdAovU3VidHlwZSAvSW1hZ2UKL1dpZHRoIDMyMAovSGVpZ2h0IDMyMAovRmlsdGVyIC9E' +
  'Q1REZWNvZGUKL0JpdHNQZXJDb21wb25lbnQgOAovQ29sb3JTcGFjZSAvRGV2aWNlUkdCCi9MZW5ndGggNDc3MQo+PnN0cmVhbQr/' +
  '2P/gABBKRklGAAEBAAABAAEAAP/bAEMACAYGBwYFCAcHBwkJCAoMFA0MCwsMGRITDxQdGh8eHRocHCAkLicgIiwjHBwoNyksMDE0' +
  'NDQfJzk9ODI8LjM0Mv/bAEMBCQkJDAsMGA0NGDIhHCEyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjIyMjIyMv/AABEIAUABQAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUE' +
  'BAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZX' +
  'WFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj' +
  '5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQID' +
  'EQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZn' +
  'aGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery' +
  '8/T19vf4+fr/2gAMAwEAAhEDEQA/APcqKKwIor/UtV1YDWb21itrlYY4oI4CoHkxOeXjY5y571kUb9FZH9j33/Qyap/37tf/AIzR' +
  '/Y99/wBDJqn/AH7tf/jNAGvRWR/Y99/0Mmqf9+7X/wCM0f2Pff8AQyap/wB+7X/4zQBr0Vkf2Pff9DJqn/fu1/8AjNH9j33/AEMm' +
  'qf8Afu1/+M0Aa9FZH9j33/Qyap/37tf/AIzR/Y99/wBDJqn/AH7tf/jNAGvRWR/Y99/0Mmqf9+7X/wCM0f2Pff8AQyap/wB+7X/4' +
  'zQBr0Vkf2Pff9DJqn/fu1/8AjNH9j33/AEMmqf8Afu1/+M0Aa9FZH9j33/Qyap/37tf/AIzR/Y99/wBDJqn/AH7tf/jNAGvRWR/Y' +
  '99/0Mmqf9+7X/wCM0f2Pff8AQyap/wB+7X/4zQBr0Vkf2Pff9DJqn/fu1/8AjNH9j33/AEMmqf8Afu1/+M0Aa9FZH9j33/Qyap/3' +
  '7tf/AIzR/Y99/wBDJqn/AH7tf/jNAGvRWR/Y99/0Mmqf9+7X/wCM0f2Pff8AQyap/wB+7X/4zQBr0Vkf2Pff9DJqn/fu1/8AjNH9' +
  'j33/AEMmqf8Afu1/+M0Aa9FZH9j33/Qyap/37tf/AIzR/Y99/wBDJqn/AH7tf/jNAGvRWR/Y99/0Mmqf9+7X/wCM0f2Pff8AQyap' +
  '/wB+7X/4zQBr0Vkf2Pff9DJqn/fu1/8AjNH9j33/AEMmqf8Afu1/+M0Aa9FZH9j33/Qyap/37tf/AIzR/Y99/wBDJqn/AH7tf/jN' +
  'AGvRWR/Y99/0Mmqf9+7X/wCM0f2Pff8AQyap/wB+7X/4zQBr0Vkf2Pff9DJqn/fu1/8AjNH9j33/AEMmqf8Afu1/+M0Aa9Fc7qNv' +
  'qOmQwXKa9fzf6XbRtHLHb7WV5kRgdsQPRj0IroqACsjR/wDkKeIP+v8AT/0mgrXrI0f/AJCniD/r/T/0mgoA16KKKACiiigAoooo' +
  'AKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAyPEn/ILh/6/7L/0pirX' +
  'rI8Sf8guH/r/ALL/ANKYq16ACsjR/wDkKeIP+v8AT/0mgrXrI0f/AJCniD/r/T/0mgoA16KKKACiiigAooooAKKKKACiiigAoooo' +
  'AKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAyPEn/ILh/6/7L/0pirXrI8Sf8guH/r/ALL/' +
  'ANKYq16ACsjR/wDkKeIP+v8AT/0mgrXrI0f/AJCniD/r/T/0mgoA16KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoooo' +
  'AKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAyPEn/ILh/6/7L/0pirXrI8Sf8guH/r/ALL/ANKYq16ACsjR/wDk' +
  'KeIP+v8AT/0mgrXrI0f/AJCniD/r/T/0mgoA16KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoooo' +
  'AKKKKACiiigAooooAKKKKACiiigAooooAyPEn/ILh/6/7L/0pirXrI8Sf8guH/r/ALL/ANKYq16ACsjR/wDkKeIP+v8AT/0mgrXr' +
  'I0f/AJCniD/r/T/0mgoA16KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoooo' +
  'AKKKKACiiigAooooAyPEn/ILh/6/7L/0pirXrI8Sf8guH/r/ALL/ANKYq16ACsjR/wDkKeIP+v8AT/0mgrXrI0f/AJCniD/r/T/0' +
  'mgoA16KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoooo' +
  'AyPEn/ILh/6/7L/0pirXrI8Sf8guH/r/ALL/ANKYq16ACsjR/wDkKeIP+v8AT/0mgrXrI0f/AJCniD/r/T/0mgoA16KKKACiiigA' +
  'ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAyPEn/ILh/6/7L/0' +
  'pirXrI8Sf8guH/r/ALL/ANKYq16ACsjR/wDkKeIP+v8AT/0mgrXrI0f/AJCniD/r/T/0mgoA16KKKACiiigAooooAKKKKACiiigA' +
  'ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAyPEn/ILh/6/7L/0pirXrI8Sf8guH/r/' +
  'ALL/ANKYq16ACsjR/wDkKeIP+v8AT/0mgrXrI0f/AJCniD/r/T/0mgoA16K5rxdb/ap/D8P2O1vN2ot+4ujiNv8ARpzydrdOvQ8g' +
  'VyekNp8Othb+30ZmFpEAuoTqhtyLq63Rw5RtwQ/KPu8KvTPBYD1GiuM8N/2SzaWW/wCRh+b7d5WPNEmxvM87vs3fdzxnZjisLQZN' +
  'PbwVpK28GjR3IbSvMaznV5n/ANIgyZFCAqc9eTzRYD1CiuG0LQRfXD3Ulhp6W6anqBmlHzS3SmeZPLkXaBtBIPLN9xeB2veHLOHT' +
  'fD2oXOl6VbtefbL5UjiVIzJtuZQiluMAYA9hQB1dFeYwzWdlZ6zDrUJa4fVV8uLUJY1jnne1izvwzAKMl/RRtxkgAehaTCLfRrGB' +
  'br7UI7eNBcZz5uFA35756/jQBcooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKA' +
  'MjxJ/wAguH/r/sv/AEpirXrI8Sf8guH/AK/7L/0pirXoAKyNH/5CniD/AK/0/wDSaCtesjR/+Qp4g/6/0/8ASaCgDXooooAKKKKA' +
  'CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDI8Sf8AILh/6/7L' +
  '/wBKYq16yPEn/ILh/wCv+y/9KYq16ACsjR/+Qp4g/wCv9P8A0mgrXrI0f/kKeIP+v9P/AEmgoA16KKKACiiigAooooAKKKKACiii' +
  'gAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAyPEn/ACC4f+v+y/8ASmKtesjxJ/yC' +
  '4f8Ar/sv/SmKtegArI0f/kKeIP8Ar/T/ANJoK16yNH/5CniD/r/T/wBJoKANeiiigAooooAKKKKACiiigAooooAKKKKACiiigAoo' +
  'ooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAMjxJ/wAguH/r/sv/AEpirXrI8Sf8guH/AK/7L/0pirXo' +
  'AKyNH/5CniD/AK/0/wDSaCtesjR/+Qp4g/6/0/8ASaCgDXooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK' +
  'KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDI8Sf8AILh/6/7L/wBKYq16yPEn/ILh/wCv+y/9KYq16ACsjR/+Qp4g/wCv' +
  '9P8A0mgrXrI0f/kKeIP+v9P/AEmgoA16KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKA' +
  'CiiigAooooAKKKKACiiigAooooAyPEn/ACC4f+v+y/8ASmKtesjxJ/yC4f8Ar/sv/SmKtegArI0f/kKeIP8Ar/T/ANJoK16yNH/5' +
  'CniD/r/T/wBJoKANeiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiii' +
  'gAooooAKKKKAMjxJ/wAguH/r/sv/AEpirXrI8Sf8guH/AK/7L/0pirXoAKyNH/5CniD/AK/0/wDSaCtesjR/+Qp4g/6/0/8ASaCg' +
  'DXooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDI8' +
  'Sf8AILh/6/7L/wBKYq16yPEn/ILh/wCv+y/9KYq16ACsjR/+Qp4g/wCv9P8A0mgrXrI0f/kKeIP+v9P/AEmgoA16KKKACiiigAoo' +
  'ooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAyPEn/ACC4f+v+y/8A' +
  'SmKtesjxJ/yC4f8Ar/sv/SmKtegArI0f/kKeIP8Ar/T/ANJoK16yNH/5CniD/r/T/wBJoKANeiiigAooooAKKKKACiiigAooooAK' +
  'KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAMjxJ/wAguH/r/sv/AEpirXrI8Sf8guH/' +
  'AK/7L/0pirXoAK5231GLTNX1pLm3v/312kkbRWE0qsv2eFchkQjqrDr2roqKAMj/AISSx/54ap/4Krr/AON0f8JJY/8APDVP/BVd' +
  'f/G616KAMj/hJLH/AJ4ap/4Krr/43R/wklj/AM8NU/8ABVdf/G616KAMj/hJLH/nhqn/AIKrr/43R/wklj/zw1T/AMFV1/8AG616' +
  'KAMj/hJLH/nhqn/gquv/AI3R/wAJJY/88NU/8FV1/wDG616KAMj/AISSx/54ap/4Krr/AON0f8JJY/8APDVP/BVdf/G616KAMj/h' +
  'JLH/AJ4ap/4Krr/43R/wklj/AM8NU/8ABVdf/G616KAMj/hJLH/nhqn/AIKrr/43R/wklj/zw1T/AMFV1/8AG616KAMj/hJLH/nh' +
  'qn/gquv/AI3R/wAJJY/88NU/8FV1/wDG616KAMj/AISSx/54ap/4Krr/AON0f8JJY/8APDVP/BVdf/G616KAMj/hJLH/AJ4ap/4K' +
  'rr/43R/wklj/AM8NU/8ABVdf/G616KAMj/hJLH/nhqn/AIKrr/43R/wklj/zw1T/AMFV1/8AG616KAMj/hJLH/nhqn/gquv/AI3R' +
  '/wAJJY/88NU/8FV1/wDG616KAMj/AISSx/54ap/4Krr/AON0f8JJY/8APDVP/BVdf/G616KAMj/hJLH/AJ4ap/4Krr/43R/wklj/' +
  'AM8NU/8ABVdf/G616KAMj/hJLH/nhqn/AIKrr/43R/wklj/zw1T/AMFV1/8AG616KAMj/hJLH/nhqn/gquv/AI3R/wAJJY/88NU/' +
  '8FV1/wDG616KAMj/AISSx/54ap/4Krr/AON0f8JJY/8APDVP/BVdf/G616KAMj/hJLH/AJ4ap/4Krr/43R/wklj/AM8NU/8ABVdf' +
  '/G616KAOa1bVodStre1tbbUmla9tW+fTrhFAWeNmJZkAAABPJ7V0tFFAH//ZCmVuZHN0cmVhbQplbmRvYmoKMiAwIG9iajw8Ci9S' +
  'ZXNvdXJjZXMgPDwKL1Byb2NTZXQgWyAvUERGIC9JbWFnZUMgXQovWE9iamVjdCA8PAovaW1hZ2UgMSAwIFIKPj4KPj4KL01lZGlh' +
  'Qm94IFsgMCAwIDMyMC4wIDMyMC4wIF0KL0NvbnRlbnRzIDMgMCBSCi9UeXBlIC9QYWdlCi9QYXJlbnQgNSAwIFIKPj5lbmRvYmoK' +
  'MyAwIG9iajw8Ci9MZW5ndGggNDcKPj5zdHJlYW0KcSAzMjAuMDAwMDAwIDAgMCAzMjAuMDAwMDAwIDAgMCBjbSAvaW1hZ2UgRG8g' +
  'UQoKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqPDwKL1RpdGxlICj+/wB0AGkAbgB5AC0AcwBjAGEAbikKL0NyZWF0aW9uRGF0ZSAo' +
  'RDoyMDI2MDcxNDA4MzIzMFopCi9Nb2REYXRlIChEOjIwMjYwNzE0MDgzMjMwWikKPj5lbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAw' +
  'MCA2NTUzNiBmIAowMDAwMDAwMTUxIDAwMDAwIG4gCjAwMDAwMDUwODggMDAwMDAgbiAKMDAwMDAwNTI1MCAwMDAwMCBuIAowMDAw' +
  'MDAwMDQ3IDAwMDAwIG4gCjAwMDAwMDAwOTQgMDAwMDAgbiAKMDAwMDAwNTM0NSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9Sb290IDQg' +
  'MCBSCi9TaXplIDcKL0luZm8gNiAwIFIKPj4Kc3RhcnR4cmVmCjU0NTcKJSVFT0Y=';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'lmthing-uploads-'));
  tmpDirs.push(d);
  return d;
}

describe('uploads', () => {
  it('classifies media kinds by IANA type', () => {
    expect(classifyKind('image/png')).toBe('image');
    expect(classifyKind('image/jpeg')).toBe('image');
    expect(classifyKind('audio/mpeg')).toBe('audio');
    expect(classifyKind('audio/wav')).toBe('audio');
    expect(classifyKind('application/pdf')).toBe('file');
    expect(classifyKind('text/plain')).toBe('file');
  });

  it('only accepts randomUUID-shaped ids (path-traversal guard)', () => {
    expect(isSafeUploadId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isSafeUploadId('../etc/passwd')).toBe(false);
    expect(isSafeUploadId('foo/bar')).toBe(false);
    expect(isSafeUploadId('')).toBe(false);
    expect(isSafeUploadId('123e4567-e89b-12d3-a456-426614174000.json')).toBe(false);
  });

  it('builds the serving url from an id', () => {
    expect(uploadUrl('abc')).toBe('/api/uploads/abc');
  });

  it('resolves the uploads dir under the runtime root', () => {
    expect(resolveUploadsDir('/data/.lmthing')).toBe('/data/.lmthing/uploads');
  });

  it('round-trips bytes + metadata through disk', async () => {
    const dir = await makeDir();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const meta = await saveUpload(dir, { bytes, mediaType: 'image/png', filename: 'pic.png' });
    expect(meta.kind).toBe('image');
    expect(meta.mediaType).toBe('image/png');
    expect(meta.filename).toBe('pic.png');
    expect(isSafeUploadId(meta.id)).toBe(true);

    const readMeta = await readUploadMeta(dir, meta.id);
    expect(readMeta).toEqual(meta);
    const readBytes = await readUploadBytes(dir, meta.id);
    expect(readBytes).not.toBeNull();
    expect(Array.from(readBytes!)).toEqual([1, 2, 3, 4, 5]);
  });

  it('persists a transcript for audio uploads', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, {
      bytes: new Uint8Array([9]),
      mediaType: 'audio/mpeg',
      filename: 'clip.mp3',
      transcript: 'hello world',
    });
    expect(meta.kind).toBe('audio');
    const readMeta = await readUploadMeta(dir, meta.id);
    expect(readMeta?.transcript).toBe('hello world');
  });

  it('extractDocumentText pulls text out of a PDF', async () => {
    const bytes = new Uint8Array(Buffer.from(TINY_PDF_B64, 'base64'));
    const text = await extractDocumentText('application/pdf', bytes);
    expect(text).toContain('MASCOT_IS_PICO');
  });

  it('extractDocumentText returns undefined for non-pdf and for garbage bytes', async () => {
    expect(await extractDocumentText('application/octet-stream', new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(await extractDocumentText('application/pdf', new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it('extractOfficeText pulls text out of a .docx', async () => {
    const bytes = new Uint8Array(Buffer.from(TINY_DOCX_B64, 'base64'));
    const text = await extractOfficeText(bytes);
    expect(text).toContain('revenue grew by 20 percent');
    expect(text).toContain('shipped three features');
  });

  it('extractOfficeText returns undefined for garbage bytes', async () => {
    expect(await extractOfficeText(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it('returns null for an unsafe or missing id', async () => {
    const dir = await makeDir();
    expect(await readUploadMeta(dir, '../secrets')).toBeNull();
    expect(await readUploadBytes(dir, '../secrets')).toBeNull();
    expect(await readUploadMeta(dir, '123e4567-e89b-12d3-a456-426614174000')).toBeNull();
  });
});

describe('resolveUploadDocument (the readDocument host resolver)', () => {
  it('decodes a text upload to text', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, {
      bytes: new TextEncoder().encode('the code is BANANA42'),
      mediaType: 'text/plain',
      filename: 'notes.txt',
    });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r).toMatchObject({ ok: true, kind: 'text', mediaType: 'text/plain', filename: 'notes.txt', text: 'the code is BANANA42' });
    expect(r.truncated).toBeUndefined();
  });

  it('caps text at maxChars and flags truncated', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, { bytes: new TextEncoder().encode('abcdefghij'), mediaType: 'text/plain' });
    const r = await resolveUploadDocument(dir, meta.id, { maxChars: 4 });
    expect(r).toMatchObject({ ok: true, kind: 'text', text: 'abcd', truncated: true });
  });

  it('extracts text from a PDF upload via unpdf', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, {
      bytes: new Uint8Array(Buffer.from(TINY_PDF_B64, 'base64')),
      mediaType: 'application/pdf',
      filename: 'doc.pdf',
    });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('text');
    expect(r.text).toContain('MASCOT_IS_PICO');
  });

  it('returns kind:unsupported for a scanned/no-text PDF', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, { bytes: new Uint8Array([1, 2, 3]), mediaType: 'application/pdf' });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('unsupported');
    expect(r.error).toMatch(/no extractable text/);
  });

  it('extracts a Word (.docx) upload to text via officeparser', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, {
      bytes: new Uint8Array(Buffer.from(TINY_DOCX_B64, 'base64')),
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'report.docx',
    });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('text');
    expect(r.text).toContain('revenue grew by 20 percent');
  });

  it('extracts an office document even with a generic media type (by extension)', async () => {
    const dir = await makeDir();
    // Browsers often send octet-stream — detection must fall back to the .docx extension.
    const meta = await saveUpload(dir, {
      bytes: new Uint8Array(Buffer.from(TINY_DOCX_B64, 'base64')),
      mediaType: 'application/octet-stream',
      filename: 'report.docx',
    });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r).toMatchObject({ ok: true, kind: 'text' });
    expect(r.text).toContain('shipped three features');
  });

  it('returns kind:unsupported for a corrupt office document', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, {
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'report.docx',
    });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('unsupported');
    expect(r.error).toMatch(/office document could not be parsed/);
  });

  it('returns kind:unsupported for a genuinely unsupported binary type', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, {
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'application/x-tar',
      filename: 'archive.tar',
    });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('unsupported');
    expect(r.error).toMatch(/not yet supported/);
  });

  it('extracts an Excel (.xlsx) upload to CSV text', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['name', 'qty'], ['apples', 5], ['pears', 3]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const dir = await makeDir();
    const meta = await saveUpload(dir, {
      bytes: new Uint8Array(buf),
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'data.xlsx',
    });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('text');
    expect(r.text).toContain('apples,5');
    expect(r.text).toContain('pears,3');
  });

  it('extracts an OpenDocument spreadsheet (.ods) even with a generic media type (by extension)', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['city', 'pop'], ['athens', 664046]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'ods' }) as Buffer;
    const dir = await makeDir();
    // Browsers often send octet-stream for .ods — detection must fall back to the filename.
    const meta = await saveUpload(dir, { bytes: new Uint8Array(buf), mediaType: 'application/octet-stream', filename: 'οικονομικα.ods' });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('text');
    expect(r.text).toContain('athens,664046');
  });

  it('returns transcript text for an audio upload', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, { bytes: new Uint8Array([9]), mediaType: 'audio/mpeg', transcript: 'hello world' });
    const r = await resolveUploadDocument(dir, meta.id);
    expect(r).toMatchObject({ ok: true, kind: 'text', text: 'hello world' });
  });

  it('rejects an image (routes to vision) and an invalid/missing id', async () => {
    const dir = await makeDir();
    const img = await saveUpload(dir, { bytes: new Uint8Array([1]), mediaType: 'image/png' });
    expect(await resolveUploadDocument(dir, img.id)).toMatchObject({ ok: false, kind: 'unsupported', error: expect.stringMatching(/system-vision/) });
    expect(await resolveUploadDocument(dir, '../secrets')).toMatchObject({ ok: false, kind: 'unsupported', error: 'invalid attachment id' });
    expect(await resolveUploadDocument(dir, '123e4567-e89b-12d3-a456-426614174000')).toMatchObject({ ok: false, error: 'attachment not found' });
  });
});

describe('scanned (image-only) PDFs reach a vision model', () => {
  it('extracts a scanned page as a PNG — the only way a text-less document can be READ', async () => {
    const bytes = new Uint8Array(Buffer.from(SCANNED_PDF_B64, 'base64'));

    // Premise: this PDF has no text layer at all, so the text path yields nothing…
    expect(await extractDocumentText('application/pdf', bytes)).toBeUndefined();

    // …and without page images, the file would be routed as a document (no image part),
    // leaving no model in the system able to look at it. The pages must come back as PNGs.
    const pages = await extractPdfPageImages(bytes);
    expect(pages.length).toBe(1);
    expect(Buffer.from(pages[0]!.slice(0, 8))).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG magic
    );
    expect(pages[0]!.length).toBeGreaterThan(1000);
  });

  it('a text PDF is NOT rasterized (nothing to look at — its text was extracted)', async () => {
    const bytes = new Uint8Array(Buffer.from(TINY_PDF_B64, 'base64'));
    expect(await extractDocumentText('application/pdf', bytes)).toContain('MASCOT_IS_PICO');
    expect(await extractPdfPageImages(bytes)).toEqual([]);
  });

  it("readDocument on a scan names the page images instead of dead-ending on 'unsupported'", async () => {
    const dir = await makeDir();
    const page = await saveUpload(dir, { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' });
    const scan = await saveUpload(dir, {
      bytes: new Uint8Array(Buffer.from(SCANNED_PDF_B64, 'base64')),
      mediaType: 'application/pdf',
      filename: 'receipt.pdf',
      pages: [page.id],
    });
    const res = await resolveUploadDocument(dir, scan.id);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe('unsupported');
    expect(res.error).toContain(page.id); // it can hand the page to vision by id
    expect(res.error).toMatch(/vision/i);
  });
});
