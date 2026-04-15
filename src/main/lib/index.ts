import { appDirectoryName, fileEncoding, welcomeNoteFilename } from '@shared/constants'
import { NoteInfo } from '@shared/models'
import { CreateNote, DeleteNote, GetNotes, ReadNote, WriteNote } from '@shared/types'
import { deleteNoteByTitle, getAllNotes, insertNote, updateNoteTimestamp } from './database'
import { dialog } from 'electron'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { isEmpty } from 'lodash'
import { homedir } from 'os'
import path from 'path'
import welcomeNoteFile from '../../../resources/welcomeNote.md?asset'

export const getRootDir = () => {
  return `${homedir()}/${appDirectoryName}`
}

export const getNotes: GetNotes = async () => {
  const rootDir = getRootDir()

  await mkdir(rootDir, { recursive: true })

  // Try to get notes from database first
  let notes = getAllNotes()

  // If database is empty (first run), scan file system and populate database
  if (isEmpty(notes)) {
    console.info('[Notes] Database empty, scanning file system')

    const notesFileNames = await readdir(rootDir, {
      encoding: fileEncoding,
      withFileTypes: false
    })

    const mdFiles = notesFileNames.filter((fileName) => fileName.endsWith('.md'))

    if (isEmpty(mdFiles)) {
      console.info('[Notes] No notes found, creating a welcome note')

      const content = await readFile(welcomeNoteFile, { encoding: fileEncoding })

      // create the welcome note
      await writeFile(`${rootDir}/${welcomeNoteFilename}`, content, { encoding: fileEncoding })

      const stats = await stat(`${rootDir}/${welcomeNoteFilename}`)
      insertNote(welcomeNoteFilename.replace(/\.md$/, ''), stats.mtimeMs)
      notes = [
        { id: 1, title: welcomeNoteFilename.replace(/\.md$/, ''), lastEditTime: stats.mtimeMs }
      ]
    } else {
      // Populate database from file system
      for (const filename of mdFiles) {
        const stats = await stat(`${rootDir}/${filename}`)
        insertNote(filename.replace(/\.md$/, ''), stats.mtimeMs)
      }
      notes = getAllNotes()
    }
  }

  return notes.map((note) => ({
    title: note.title,
    lastEditTime: note.lastEditTime
  }))
}

export const getNoteInfoFromFilename = async (filename: string): Promise<NoteInfo> => {
  const fileStats = await stat(`${getRootDir()}/${filename}`)

  return {
    title: filename.replace(/\.md$/, ''),
    lastEditTime: fileStats.mtimeMs
  }
}

export const readNote: ReadNote = async (filename) => {
  const rootDir = getRootDir()

  return readFile(`${rootDir}/${filename}.md`, { encoding: fileEncoding })
}

export const writeNote: WriteNote = async (filename, content) => {
  const rootDir = getRootDir()

  console.info(`Writing note ${filename}`)
  await writeFile(`${rootDir}/${filename}.md`, content, { encoding: fileEncoding })

  // Update timestamp in database
  const stats = await stat(`${rootDir}/${filename}.md`)
  updateNoteTimestamp(filename, stats.mtimeMs)
}

export const createNote: CreateNote = async () => {
  const rootDir = getRootDir()

  await mkdir(rootDir, { recursive: true })

  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'New note',
    defaultPath: `${rootDir}/Untitled.md`,
    buttonLabel: 'Create',
    properties: ['showOverwriteConfirmation'],
    showsTagField: false,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })

  if (canceled || !filePath) {
    console.info('Note creation canceled')
    return false
  }

  const { name: filename, dir: parentDir } = path.parse(filePath)

  if (parentDir !== rootDir) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Creation failed',
      message: `All notes must be saved under ${rootDir}.
      Avoid using other directories!`
    })

    return false
  }

  console.info(`Creating note: ${filePath}`)
  await writeFile(filePath, '')

  // Add to database
  const stats = await stat(filePath)
  insertNote(filename, stats.mtimeMs)

  return filename
}

export const deleteNote: DeleteNote = async (filename) => {
  const rootDir = getRootDir()

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Delete note',
    message: `Are you sure you want to delete ${filename}?`,
    buttons: ['Delete', 'Cancel'], // 0 is Delete, 1 is Cancel
    defaultId: 1,
    cancelId: 1
  })

  if (response === 1) {
    console.info('Note deletion canceled')
    return false
  }

  console.info(`Deleting note: ${filename}`)
  await rm(`${rootDir}/${filename}.md`, { force: true })

  // Remove from database
  deleteNoteByTitle(filename)

  return true
}
