export type SettingsDoc = {
  _id: 'global'
  maintenance?: boolean
  bannerFileId?: string
  logChats?: {
    core?: number
    plays?: number
    error?: number
  }
}
