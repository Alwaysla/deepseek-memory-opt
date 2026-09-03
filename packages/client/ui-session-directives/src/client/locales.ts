/** Locale namespace owned by the session-directives view. */
export const NS = 'sessionDirectives'

/** Message keys rendered by the session-directives view. */
export type SessionDirectivesKey =
  | 'view.label' | 'title' | 'empty' | 'add' | 'clear' | 'key' | 'value' | 'scope.session'
  | 'source.user' | 'source.automatic' | 'save' | 'cancel' | 'edit' | 'delete' | 'saving' | 'error'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { sessionDirectives: SessionDirectivesKey }
}

/** Simplified Chinese strings for the session-directives view. */
export const zh: Record<SessionDirectivesKey, string> = {
  'view.label': '持续指令', title: '会话持续指令', empty: '暂无持续指令。', add: '添加指令', clear: '全部清除',
  key: '名称', value: '内容', 'scope.session': '当前会话', 'source.user': '手动', 'source.automatic': '自动',
  save: '保存', cancel: '取消', edit: '编辑', delete: '删除', saving: '正在保存…', error: '操作失败',
}

/** English strings for the session-directives view. */
export const en: Record<SessionDirectivesKey, string> = {
  'view.label': 'Directives', title: 'Session directives', empty: 'No persistent directives.', add: 'Add directive', clear: 'Clear all',
  key: 'Key', value: 'Value', 'scope.session': 'Session', 'source.user': 'Manual', 'source.automatic': 'Automatic',
  save: 'Save', cancel: 'Cancel', edit: 'Edit', delete: 'Delete', saving: 'Saving…', error: 'Operation failed',
}
