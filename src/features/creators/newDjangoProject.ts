import * as fs from 'fs-extra';
import * as path from 'path';
import { commands, l10n, MarkdownString, QuickInputButtons, Uri, window, workspace } from 'vscode';
import { PythonEnvironment, PythonProject, PythonProjectCreator, PythonProjectCreatorOptions } from '../../api';
import { NEW_PROJECT_TEMPLATES_FOLDER, VENV_MANAGER_ID } from '../../common/constants';
import { traceError } from '../../common/logging';
import { showInputBoxWithButtons } from '../../common/window.apis';
import type { EnvironmentManagers } from '../envManagers';
import type { PythonProjectManager } from '../projectManager';
import {
    isCopilotInstalled,
    manageCopilotInstructionsFile,
    manageLaunchJsonFile,
    promptForVenv,
    replaceInFilesAndNames,
} from './creationHelpers';

/** Quick-create project type accepted by `python-envs.createNewProjectFromTemplate`. */
export const DJANGO_PROJECT_TYPE = 'python-django';

/** Stable creator id. Not localized, so command lookup keeps working in every locale. */
export const DJANGO_CREATOR_NAME = 'newDjango';

const DJANGO_TEMPLATE_DIRECTORY = 'newDjangoTemplate';
const DJANGO_COPILOT_INSTRUCTIONS = 'django-copilot-instructions.md';

/**
 * Validates a Django project name using the same PEP 508-style rules as the package template.
 * The name is also the Python package that holds the generated Django settings.
 * @param value - The project name entered by the user or supplied to quick create.
 * @returns An error message when the name is invalid, otherwise `null`.
 */
export function validateDjangoProjectName(value: string): string | null {
    // following PyPI (PEP 508) rules for package names
    if (!/^([a-z_]|[a-z0-9_][a-z0-9._-]*[a-z0-9_])$/i.test(value)) {
        return l10n.t(
            'Invalid project name. Use only letters, numbers, underscores, hyphens, or periods. Must start and end with a letter or number.',
        );
    }
    if (/^[-._0-9]$/i.test(value)) {
        return l10n.t('Single-character project names cannot be a number, hyphen, or period.');
    }
    return null;
}

/**
 * Scaffolds a Django project from `files/templates/newDjangoTemplate`.
 * Interactive creation asks for a name and whether to create a virtual environment.
 * Quick create requires a name and root, then creates the environment without prompts.
 */
export class NewDjangoProject implements PythonProjectCreator {
    public readonly name = DJANGO_CREATOR_NAME;
    public readonly displayName = l10n.t('Django');
    public readonly description = l10n.t('Creates a Django project in your current workspace');
    public readonly tooltip = new MarkdownString(l10n.t('Create a new Django project'));
    public readonly supportsQuickCreate = true;

    constructor(
        private readonly envManagers: EnvironmentManagers,
        private readonly projectManager: PythonProjectManager,
    ) {}

    async create(options?: PythonProjectCreatorOptions): Promise<PythonProject | Uri | undefined> {
        let packageName = options?.name;
        let createVenv: boolean | undefined;
        let createCopilotInstructions: boolean | undefined;
        if (options?.quickCreate === true) {
            if (!packageName) {
                throw new Error('Django project name is required in quickCreate mode.');
            }
            createVenv = true;
            createCopilotInstructions = true;
        } else if (!packageName) {
            try {
                packageName = await showInputBoxWithButtons({
                    prompt: l10n.t('What is the name of the Django project? (e.g. my_django)'),
                    ignoreFocusOut: true,
                    showBackButton: true,
                    validateInput: validateDjangoProjectName,
                });
            } catch (ex) {
                if (ex === QuickInputButtons.Back) {
                    await commands.executeCommand('python-envs.createNewProjectFromTemplate');
                }
            }
            if (!packageName) {
                return undefined;
            }
            const callback = () => {
                return this.create(options);
            };
            createVenv = await promptForVenv(callback);
            if (createVenv === undefined) {
                return undefined;
            }
            if (isCopilotInstalled()) {
                createCopilotInstructions = true;
            }
        }

        const validationError = validateDjangoProjectName(packageName);
        if (validationError) {
            if (options?.quickCreate === true) {
                throw new Error(validationError);
            }
            window.showErrorMessage(validationError);
            return undefined;
        }

        const templateFolder = path.join(NEW_PROJECT_TEMPLATES_FOLDER, DJANGO_TEMPLATE_DIRECTORY);
        if (!(await fs.pathExists(templateFolder))) {
            window.showErrorMessage(l10n.t('Template folder does not exist, aborting creation.'));
            traceError(`Django template folder not found at: ${templateFolder}`);
            return undefined;
        }

        let destRoot = options?.rootUri?.fsPath;
        if (!destRoot) {
            const workspaceFolders = workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                window.showErrorMessage(l10n.t('No workspace folder is open or provided, aborting creation.'));
                traceError('No workspace folder is open for Django project creation.');
                return undefined;
            }
            destRoot = workspaceFolders[0].uri.fsPath;
        }

        const projectDestinationFolder = path.join(destRoot, `${packageName}_project`);
        if (await fs.pathExists(projectDestinationFolder)) {
            window.showErrorMessage(
                l10n.t(
                    'A project folder by that name already exists, aborting creation. Please retry with a unique project name given your workspace.',
                ),
            );
            return undefined;
        }
        await fs.copy(templateFolder, projectDestinationFolder);
        await replaceInFilesAndNames(projectDestinationFolder, 'package_name', packageName);

        const createdProject: PythonProject = {
            name: packageName,
            uri: Uri.file(projectDestinationFolder),
        };
        await this.projectManager.add(createdProject);

        let createdEnv: PythonEnvironment | undefined;
        if (createVenv) {
            const en = this.envManagers.getEnvironmentManager(undefined);
            if (en?.supportsQuickCreate) {
                createdEnv = await en.create(Uri.file(projectDestinationFolder), { quickCreate: true });
            } else if (!options?.quickCreate && en?.supportsCreate) {
                createdEnv = await en.create(Uri.file(projectDestinationFolder), {});
            } else {
                const venvManager = this.envManagers.managers.find(
                    (manager) => manager.id === VENV_MANAGER_ID || manager.supportsQuickCreate,
                );
                if (venvManager) {
                    createdEnv = await venvManager.create(Uri.file(projectDestinationFolder), { quickCreate: true });
                } else {
                    const action = await window.showErrorMessage(
                        l10n.t(
                            'A virtual environment could not be created for the new Django project "{0}" because your default environment manager does not support this operation and no alternative was available.',
                            packageName,
                        ),
                        l10n.t('Create custom environment'),
                    );
                    if (action === l10n.t('Create custom environment')) {
                        await commands.executeCommand('python-envs.createAny', {
                            uri: createdProject.uri,
                            selectEnvironment: true,
                        });
                        createdEnv = await this.envManagers.getEnvironment(createdProject.uri);
                    }
                }
            }
        }

        createdEnv = createdEnv || (await this.envManagers.getEnvironment(Uri.file(projectDestinationFolder)));
        if (!createdEnv) {
            window.showErrorMessage(
                l10n.t('Project created but unable to be correlated to correct Python environment.'),
            );
            return undefined;
        }
        await this.envManagers.setEnvironment(createdProject.uri, createdEnv);

        if (createCopilotInstructions) {
            const instructionsPath = path.join(
                NEW_PROJECT_TEMPLATES_FOLDER,
                'copilot-instructions-text',
                DJANGO_COPILOT_INSTRUCTIONS,
            );
            await manageCopilotInstructionsFile(destRoot, instructionsPath, [
                { searchValue: '<package_name>', replaceValue: packageName },
            ]);
        }

        const launchJsonConfig = {
            name: `Python: Django (${packageName})`,
            type: 'debugpy',
            request: 'launch',
            program: `\${workspaceFolder}/${packageName}_project/manage.py`,
            args: ['runserver'],
            django: true,
            autoStartBrowser: false,
        };
        await manageLaunchJsonFile(destRoot, JSON.stringify(launchJsonConfig));

        return createdProject;
    }
}
