from django.contrib import admin

from .models import KnowledgeArticle, KnowledgeCategory


@admin.register(KnowledgeCategory)
class KnowledgeCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'parent', 'is_active', 'created_at')
    list_filter = ('is_active', 'parent')
    search_fields = ('name', 'description')


@admin.register(KnowledgeArticle)
class KnowledgeArticleAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'subcategory', 'status', 'view_count', 'updated_at')
    list_filter = ('status', 'category')
    search_fields = ('title', 'summary', 'content')
    readonly_fields = ('created_at', 'updated_at', 'published_at')
